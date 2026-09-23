"""Authenticated backend gateway for AI zones and occupancy."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import ai_client
from app.models.entities import Agency, Camera, RoleName, User
from app.schemas.ai_zoning import ZoneCreateRequest


router = APIRouter(
    prefix="/agencies/{agency_id}/ai",
    tags=["AI zoning"],
)
ZONE_READ_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]
ZONE_WRITE_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))
]


def _ensure_agency_scope(agency_id: str, current_user: User, db: Session) -> None:
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def _agency_cameras(
    agency_id: str,
    source_names: set[str],
    db: Session,
) -> dict[str, Camera]:
    cameras = list(
        db.scalars(
            select(Camera).where(
                Camera.agency_id == agency_id,
                Camera.name.in_(source_names),
            )
        ).all()
    )
    by_name = {camera.name: camera for camera in cameras}
    missing = sorted(source_names - set(by_name))
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Camera(s) introuvable(s) dans cette agence: {missing}",
        )
    without_stream = sorted(
        name for name, camera in by_name.items() if not camera.stream_url
    )
    if without_stream:
        raise HTTPException(
            status_code=422,
            detail=f"Flux manquant pour la/les camera(s): {without_stream}",
        )
    return by_name


def _normalise_sources(payload: ZoneCreateRequest, db: Session, agency_id: str) -> dict[str, str]:
    source_names = set(payload.sources)
    if payload.camera not in source_names:
        raise HTTPException(
            status_code=422,
            detail="La camera de dessin doit apparaitre dans sources",
        )
    cameras = _agency_cameras(agency_id, source_names, db)

    # PostgreSQL remains the source of truth for stream URLs. The frontend may
    # send them for convenience, but it cannot make the AI service read an
    # arbitrary URL or silently diverge from /api/agencies/{id}/cameras.
    for name, submitted_url in payload.sources.items():
        if not submitted_url.strip():
            raise HTTPException(status_code=422, detail=f"Flux vide pour la camera {name}")

    return {name: cameras[name].stream_url for name in sorted(cameras)}


def _ensure_world_tracking_ready(source_count: int) -> None:
    if source_count <= 1:
        return
    tracking = ai_client.get_people_status()
    if not isinstance(tracking, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    if tracking.get("phase") != "running":
        phase = tracking.get("phase", "inconnu")
        raise HTTPException(
            status_code=422,
            detail=(
                "Le person tracking doit etre en etat running avant de creer "
                f"une zone mondiale (etat actuel: {phase})"
            ),
        )


@router.get("/zones", dependencies=ZONE_READ_ROLES)
def list_zones(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    """List the AI zones for the current agency."""
    _ensure_agency_scope(agency_id, current_user, db)
    return ai_client.list_zones()


@router.post(
    "/zones",
    status_code=status.HTTP_201_CREATED,
    dependencies=ZONE_WRITE_ROLES,
)
def create_zone(
    agency_id: str,
    payload: ZoneCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    """Create a pixel zone or a calibrated world zone."""
    _ensure_agency_scope(agency_id, current_user, db)
    sources = _normalise_sources(payload, db, agency_id)
    _ensure_world_tracking_ready(len(sources))

    ai_payload = payload.model_dump()
    ai_payload["name"] = payload.name.strip()
    ai_payload["camera"] = payload.camera.strip()
    ai_payload["sources"] = sources
    return ai_client.create_zone(ai_payload)


@router.delete(
    "/zones/{zone_name}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=ZONE_WRITE_ROLES,
)
def delete_zone(
    agency_id: str,
    zone_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete one zone; AI returns 404 when the name does not exist."""
    _ensure_agency_scope(agency_id, current_user, db)
    ai_client.delete_zone(zone_name)
