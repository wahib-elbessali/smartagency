"""Authenticated backend gateway for the AI calibration module."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import ai_client
from app.models.entities import Agency, Camera, RoleName, User
from app.schemas.ai_calibration import (
    CalibrationAlignRequest,
    CalibrationCrossCheckRequest,
    CalibrationGatesRequest,
    CalibrationRectRequest,
)


router = APIRouter(
    prefix="/agencies/{agency_id}/ai",
    tags=["AI calibration"],
)
CALIBRATION_ROLES = [Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))]


def _ensure_agency_scope(agency_id: str, current_user: User, db: Session) -> None:
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def _camera_names(agency_id: str, db: Session) -> set[str]:
    return set(
        db.scalars(select(Camera.name).where(Camera.agency_id == agency_id)).all()
    )


def _ensure_camera_names(
    agency_id: str,
    names: set[str],
    db: Session,
    *,
    require_stream: bool = False,
) -> None:
    query = select(Camera).where(
        Camera.agency_id == agency_id,
        Camera.name.in_(names),
    )
    cameras = list(db.scalars(query).all())
    found = {camera.name for camera in cameras}
    missing = sorted(names - found)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Camera(s) introuvable(s) dans cette agence: {missing}",
        )
    if require_stream:
        without_stream = sorted(
            camera.name for camera in cameras if not camera.stream_url
        )
        if without_stream:
            raise HTTPException(
                status_code=422,
                detail=f"Flux manquant pour la/les camera(s): {without_stream}",
            )


def _align_camera_names(payload: CalibrationAlignRequest) -> set[str]:
    names: set[str] = set()
    for observation in payload.points:
        names.update(observation)
    return names


@router.get("/calibration", dependencies=CALIBRATION_ROLES)
def get_calibration(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _ensure_agency_scope(agency_id, current_user, db)
    known_names = _camera_names(agency_id, db)
    payload = ai_client.get("/calibration")
    if not isinstance(payload, dict):
        return {}
    return {name: value for name, value in payload.items() if name in known_names}


@router.post("/calibration/rect", dependencies=CALIBRATION_ROLES)
def calibrate_rectangle(
    agency_id: str,
    payload: CalibrationRectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    _ensure_camera_names(agency_id, {payload.camera}, db, require_stream=True)
    return ai_client.post("/calibration/rect", payload=payload.model_dump())


@router.post("/calibration/align", dependencies=CALIBRATION_ROLES)
def align_cameras(
    agency_id: str,
    payload: CalibrationAlignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    _ensure_camera_names(agency_id, _align_camera_names(payload), db)
    return ai_client.post("/calibration/align", payload=payload.model_dump())


@router.post("/calibration/cross-check", dependencies=CALIBRATION_ROLES)
def cross_check_cameras(
    agency_id: str,
    payload: CalibrationCrossCheckRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    _ensure_camera_names(agency_id, set(payload.points), db)
    return ai_client.post(
        "/calibration/cross_check",
        payload=payload.model_dump(),
    )


@router.get("/calibration/gates", dependencies=CALIBRATION_ROLES)
def get_gates(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    return ai_client.get("/calibration/gates")


@router.post("/calibration/gates", dependencies=CALIBRATION_ROLES)
def save_gates(
    agency_id: str,
    payload: CalibrationGatesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    _ensure_camera_names(agency_id, {gate.camera for gate in payload.gates}, db)
    return ai_client.post(
        "/calibration/gates",
        payload=payload.model_dump(),
    )


@router.delete("/calibration/gates", dependencies=CALIBRATION_ROLES)
def clear_gates(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    _ensure_agency_scope(agency_id, current_user, db)
    return ai_client.delete("/calibration/gates")


@router.get("/frame", dependencies=CALIBRATION_ROLES)
def get_calibration_frame(
    agency_id: str,
    camera: str = Query(min_length=1),
    format: str = Query(default="jpeg", pattern="^(png|jpeg)$"),
    quality: int = Query(default=80, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Return the AI frame used by the calibration point selector."""
    _ensure_agency_scope(agency_id, current_user, db)
    _ensure_camera_names(agency_id, {camera}, db, require_stream=True)
    content, media_type = ai_client.request_bytes(
        "GET",
        "/frame",
        params={"camera": camera, "format": format, "quality": quality},
    )
    return Response(content=content, media_type=media_type)
