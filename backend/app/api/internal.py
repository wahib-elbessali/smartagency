from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.device_security import authenticate_ingestion_device
from app.database.connection import get_db
from app.models.entities import Employee, Service, Ticket, TicketStatus, Visitor
from app.schemas.ingestion import (
    RFIDCheckRequest,
    RFIDCheckResponse,
    WalkInTicketRequest,
    WalkInTicketResponse,
)
from app.services.attendance_service import record_check_in, record_check_out
from app.services.ticket_service import next_ticket_number


router = APIRouter(prefix="/internal", tags=["Internal ingestion"])


def event_time(value: datetime | None) -> datetime:
    return value or datetime.now(timezone.utc)


def resolve_service(payload: WalkInTicketRequest, db: Session) -> Service:
    if payload.service_id:
        service = db.get(Service, payload.service_id)
    elif payload.service_type:
        lookup = payload.service_type.strip().lower()
        service = db.scalar(
            select(Service).where(
                func.lower(Service.code) == lookup,
                Service.agency_id == payload.agency_id,
            )
        )
        if service is None:
            service = db.scalar(
                select(Service).where(
                    func.lower(Service.name) == lookup,
                    Service.agency_id == payload.agency_id,
                )
            )
    else:
        service = None

    if service is None:
        raise HTTPException(status_code=404, detail="Service introuvable")
    if service.agency_id != payload.agency_id:
        raise HTTPException(status_code=422, detail="Le service appartient a une autre agence")
    if not service.is_active:
        raise HTTPException(status_code=409, detail="Le service est inactif")
    return service


@router.post("/tickets/walk-in", response_model=WalkInTicketResponse, status_code=201)
def walk_in_ticket(
    payload: WalkInTicketRequest,
    x_device_key: str | None = Header(default=None, alias="X-Device-Key"),
    db: Session = Depends(get_db),
) -> WalkInTicketResponse:
    authenticate_ingestion_device(payload.agency_id, payload.device_id, x_device_key, db)
    service = resolve_service(payload, db)
    occurred_at = event_time(payload.timestamp)
    visitor_data = payload.visitor.model_dump() if payload.visitor else {}
    visitor = Visitor(
        agency_id=payload.agency_id,
        full_name=visitor_data.get("full_name", "Visiteur borne"),
        phone=visitor_data.get("phone"),
        identity_reference=visitor_data.get("identity_reference"),
        created_at=occurred_at,
    )
    db.add(visitor)
    db.flush()

    ticket = Ticket(
        visitor_id=visitor.id,
        service_id=service.id,
        ticket_number=next_ticket_number(db, payload.agency_id, service.id, service.code),
        service_type=service.name,
        status=TicketStatus.WAITING,
        created_at=occurred_at,
    )
    db.add(ticket)
    db.commit()
    return WalkInTicketResponse(
        ticket_id=ticket.id,
        ticket_number=ticket.ticket_number,
        service_id=service.id,
        service_type=service.name,
    )


@router.post("/attendance/check-rfid", response_model=RFIDCheckResponse)
def check_rfid(
    payload: RFIDCheckRequest,
    x_device_key: str | None = Header(default=None, alias="X-Device-Key"),
    db: Session = Depends(get_db),
) -> RFIDCheckResponse:
    authenticate_ingestion_device(payload.agency_id, payload.device_id, x_device_key, db)
    employee = db.scalar(
        select(Employee).where(
            Employee.rfid_uid == payload.employee_rfid,
            Employee.agency_id == payload.agency_id,
            Employee.is_active.is_(True),
        )
    )
    if employee is None:
        return RFIDCheckResponse(valid=False, message="Carte RFID ou employe introuvable")

    try:
        if payload.event == "check_in":
            record_check_in(db, payload.employee_rfid, payload.timestamp, payload.agency_id)
        else:
            record_check_out(db, payload.employee_rfid, payload.timestamp, payload.agency_id)
    except HTTPException as exc:
        return RFIDCheckResponse(valid=False, message=str(exc.detail))

    return RFIDCheckResponse(
        valid=True,
        employee_name=f"{employee.first_name} {employee.last_name}",
        event=payload.event,
    )
