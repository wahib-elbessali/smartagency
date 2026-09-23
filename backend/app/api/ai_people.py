"""Authenticated backend gateway for AI person tracking."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import ai_client
from app.models.entities import Agency, Camera, RoleName, User


router = APIRouter(
    prefix="/agencies/{agency_id}/ai",
    tags=["AI person tracking"],
)
PEOPLE_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]


def _ensure_agency_scope(agency_id: str, current_user: User, db: Session) -> None:
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def _filter_agency_sources(payload: dict[str, Any], agency_camera_names: set[str]) -> dict[str, Any]:
    """Keep the AI status scoped to cameras belonging to this agency."""
    filtered = dict(payload)
    for key in ("sources_known", "calibrated", "aligned", "cams_bootstrapped"):
        value = filtered.get(key)
        if isinstance(value, list):
            filtered[key] = [name for name in value if name in agency_camera_names]
    return filtered


@router.get("/people/status", dependencies=PEOPLE_ROLES)
def get_people_status(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return person-tracking state, readiness and active-track count."""
    _ensure_agency_scope(agency_id, current_user, db)
    camera_names = set(
        db.scalars(select(Camera.name).where(Camera.agency_id == agency_id)).all()
    )
    payload = ai_client.get_people_status()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    return _filter_agency_sources(payload, camera_names)
