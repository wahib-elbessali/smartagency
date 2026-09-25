"""Authenticated backend gateway for AI employee activity."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import ai_client
from app.models.entities import Agency, Employee, RoleName, User, Workstation
from app.schemas.employee_activity import WorkstationCreate, WorkstationResponse


router = APIRouter(tags=["AI employee activity"])
WORKSTATION_READ_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]
WORKSTATION_WRITE_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))
]


def _ensure_agency_scope(agency_id: str, current_user: User, db: Session) -> None:
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def _employee_for_agency(
    employee_id: str | None,
    agency_id: str,
    db: Session,
) -> Employee | None:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    if employee.agency_id != agency_id:
        raise HTTPException(status_code=422, detail="L'employe doit appartenir a la meme agence")
    return employee


def _zone_exists_in_ai(zone_name: str) -> None:
    zones = ai_client.list_zones()
    if not isinstance(zones, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    if zone_name not in zones:
        raise HTTPException(
            status_code=422,
            detail=(
                f"La zone AI {zone_name!r} est introuvable. "
                "Creez-la d'abord avec POST /api/agencies/{agency_id}/ai/zones"
            ),
        )


def _state_from_ai(payload: object, *, name: str, zone: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "name": name,
            "zone": zone,
            "status": "unknown",
            "since": None,
            "zone_known": False,
        }
    return {
        "name": str(payload.get("name", name)),
        "zone": str(payload.get("zone", zone)),
        "status": str(payload.get("status", "unknown")),
        "since": payload.get("since"),
        "zone_known": bool(payload.get("zone_known", False)),
    }


def _to_response(workstation: Workstation, ai_state: object = None) -> WorkstationResponse:
    state = _state_from_ai(ai_state, name=workstation.name, zone=workstation.zone_name)
    employee_name = None
    if workstation.employee is not None:
        employee_name = f"{workstation.employee.first_name} {workstation.employee.last_name}"
    return WorkstationResponse(
        name=workstation.name,
        zone=workstation.zone_name,
        employee_id=workstation.employee_id,
        employee_name=employee_name,
        status=state["status"],
        since=state["since"],
        zone_known=state["zone_known"],
    )


def _ai_states_by_name(payload: object) -> dict[str, object]:
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    states: dict[str, object] = {}
    for state in payload:
        if isinstance(state, dict) and state.get("name"):
            states[str(state["name"])] = state
    return states


@router.get(
    "/api/agencies/{agency_id}/workstations",
    response_model=list[WorkstationResponse],
    dependencies=WORKSTATION_READ_ROLES,
)
def list_workstations(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WorkstationResponse]:
    _ensure_agency_scope(agency_id, current_user, db)
    ai_states = _ai_states_by_name(ai_client.list_workstations())
    workstations = db.scalars(
        select(Workstation)
        .options(selectinload(Workstation.employee))
        .where(Workstation.agency_id == agency_id)
        .order_by(Workstation.name)
    ).all()
    return [_to_response(workstation, ai_states.get(workstation.name)) for workstation in workstations]


@router.post(
    "/api/agencies/{agency_id}/workstations",
    response_model=WorkstationResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=WORKSTATION_WRITE_ROLES,
)
def create_workstation(
    agency_id: str,
    payload: WorkstationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkstationResponse:
    _ensure_agency_scope(agency_id, current_user, db)
    name = payload.name.strip()
    zone = payload.zone.strip()
    if not name or not zone:
        raise HTTPException(status_code=422, detail="Le nom et la zone sont obligatoires")
    employee = _employee_for_agency(payload.employee_id, agency_id, db)
    _zone_exists_in_ai(zone)

    workstation = db.scalar(select(Workstation).where(Workstation.name == name))
    if workstation is not None and workstation.agency_id != agency_id:
        raise HTTPException(status_code=409, detail="Ce poste de travail existe dans une autre agence")

    ai_state = ai_client.create_workstation({"name": name, "zone": zone})
    if workstation is None:
        workstation = Workstation(
            agency_id=agency_id,
            name=name,
            zone_name=zone,
            employee_id=employee.id if employee else None,
        )
        db.add(workstation)
    else:
        workstation.zone_name = zone
        workstation.employee_id = employee.id if employee else None
    try:
        db.commit()
        db.refresh(workstation)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Le poste de travail existe deja") from exc
    return _to_response(workstation, ai_state)


@router.delete(
    "/api/agencies/{agency_id}/workstations/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=WORKSTATION_WRITE_ROLES,
)
def delete_workstation(
    agency_id: str,
    name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _ensure_agency_scope(agency_id, current_user, db)
    workstation = db.scalar(
        select(Workstation).where(
            Workstation.agency_id == agency_id,
            Workstation.name == name,
        )
    )
    if workstation is None:
        raise HTTPException(status_code=404, detail="Poste de travail introuvable")
    ai_client.delete_workstation(name)
    db.delete(workstation)
    db.commit()
