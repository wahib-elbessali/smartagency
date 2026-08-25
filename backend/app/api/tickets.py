from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Counter, RoleName, Service, Ticket, TicketStatus, User, Visitor
from app.schemas.ticket import TicketCallRequest, TicketCreate, TicketResponse
from app.services.ticket_service import next_ticket_number


router = APIRouter(prefix="/tickets", tags=["Tickets"])
TICKET_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.AGENT))
]


def ticket_query():
    return select(Ticket).options(
        selectinload(Ticket.visitor),
        selectinload(Ticket.service),
        selectinload(Ticket.counter),
    )


def ensure_agency_scope(agency_id: str, current_user: User) -> None:
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def ticket_to_response(ticket: Ticket) -> TicketResponse:
    return TicketResponse(
        id=ticket.id,
        visitor_id=ticket.visitor_id,
        visitor_name=ticket.visitor.full_name,
        agency_id=ticket.visitor.agency_id,
        service_id=ticket.service_id,
        service_code=ticket.service.code if ticket.service else None,
        service_name=ticket.service.name if ticket.service else None,
        counter_id=ticket.counter_id,
        ticket_number=ticket.ticket_number,
        service_type=ticket.service_type,
        status=ticket.status.value,
        created_at=ticket.created_at,
        called_at=ticket.called_at,
        completed_at=ticket.completed_at,
    )


@router.post("", response_model=TicketResponse, status_code=status.HTTP_201_CREATED, dependencies=TICKET_ROLES)
def create_ticket(
    payload: TicketCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketResponse:
    visitor = db.get(Visitor, payload.visitor_id)
    if visitor is None:
        raise HTTPException(status_code=404, detail="Visiteur introuvable")
    ensure_agency_scope(visitor.agency_id, current_user)

    service = db.get(Service, payload.service_id)
    if service is None:
        raise HTTPException(status_code=404, detail="Service introuvable")
    if service.agency_id != visitor.agency_id:
        raise HTTPException(status_code=422, detail="Le service appartient a une autre agence")
    if not service.is_active:
        raise HTTPException(status_code=409, detail="Le service est inactif")

    ticket = Ticket(
        visitor_id=visitor.id,
        service_id=service.id,
        ticket_number=next_ticket_number(db, visitor.agency_id, service.id, service.code),
        service_type=payload.service_type or service.name,
        status=TicketStatus.WAITING,
    )
    db.add(ticket)
    db.commit()
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket.id))
    return ticket_to_response(ticket)


@router.get("/queue", response_model=list[TicketResponse], dependencies=TICKET_ROLES)
def get_queue(
    service_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketResponse]:
    query = (
        ticket_query()
        .join(Ticket.visitor)
        .where(Ticket.status == TicketStatus.WAITING)
        .order_by(Ticket.created_at)
    )
    if current_user.role.name != RoleName.ADMIN:
        query = query.where(Visitor.agency_id == current_user.agency_id)
    if service_id is not None:
        service = db.get(Service, service_id)
        if service is None:
            raise HTTPException(status_code=404, detail="Service introuvable")
        ensure_agency_scope(service.agency_id, current_user)
        query = query.where(Ticket.service_id == service.id)
    return [ticket_to_response(ticket) for ticket in db.scalars(query).unique().all()]


@router.post("/{ticket_id}/call", response_model=TicketResponse, dependencies=TICKET_ROLES)
def call_ticket(
    ticket_id: str,
    payload: TicketCallRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketResponse:
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket_id))
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    ensure_agency_scope(ticket.visitor.agency_id, current_user)
    if ticket.status != TicketStatus.WAITING:
        raise HTTPException(status_code=409, detail="Ce ticket n est plus en attente")

    counter = db.get(Counter, payload.counter_id)
    if counter is None:
        raise HTTPException(status_code=404, detail="Guichet introuvable")
    if counter.agency_id != ticket.visitor.agency_id:
        raise HTTPException(status_code=422, detail="Le guichet appartient a une autre agence")
    if not counter.is_open:
        raise HTTPException(status_code=409, detail="Le guichet est ferme")
    if ticket.service_id is not None and counter.service_id != ticket.service_id:
        raise HTTPException(status_code=422, detail="Le guichet n est pas affecte au service du ticket")
    if ticket.service is not None and counter.point_type != ticket.service.point_type:
        raise HTTPException(status_code=422, detail="Le type de point ne correspond pas au service du ticket")

    ticket.counter_id = counter.id
    ticket.status = TicketStatus.CALLED
    ticket.called_at = datetime.now(timezone.utc)
    db.commit()
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket.id))
    return ticket_to_response(ticket)


@router.post("/{ticket_id}/complete", response_model=TicketResponse, dependencies=TICKET_ROLES)
def complete_ticket(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketResponse:
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket_id))
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    ensure_agency_scope(ticket.visitor.agency_id, current_user)
    if ticket.status not in (TicketStatus.CALLED, TicketStatus.IN_SERVICE):
        raise HTTPException(status_code=409, detail="Ce ticket ne peut pas etre termine")
    ticket.status = TicketStatus.COMPLETED
    ticket.completed_at = datetime.now(timezone.utc)
    db.commit()
    return ticket_to_response(ticket)


@router.post("/{ticket_id}/cancel", response_model=TicketResponse, dependencies=TICKET_ROLES)
def cancel_ticket(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketResponse:
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket_id))
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    ensure_agency_scope(ticket.visitor.agency_id, current_user)
    if ticket.status in (TicketStatus.COMPLETED, TicketStatus.CANCELLED):
        raise HTTPException(status_code=409, detail="Ce ticket est deja termine ou annule")
    ticket.status = TicketStatus.CANCELLED
    db.commit()
    return ticket_to_response(ticket)
