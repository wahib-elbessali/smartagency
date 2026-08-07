from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Agency, Counter, RoleName, Ticket, TicketStatus, User, Visitor
from app.schemas.ticket import TicketCallRequest, TicketCreate, TicketResponse


router = APIRouter(prefix="/tickets", tags=["Tickets"])
TICKET_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.AGENT))
]


def ticket_query():
    return select(Ticket).options(selectinload(Ticket.visitor), selectinload(Ticket.counter))


def ensure_agency_scope(agency_id: str, current_user: User) -> None:
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def ticket_to_response(ticket: Ticket) -> TicketResponse:
    return TicketResponse(
        id=ticket.id,
        visitor_id=ticket.visitor_id,
        visitor_name=ticket.visitor.full_name,
        agency_id=ticket.visitor.agency_id,
        counter_id=ticket.counter_id,
        ticket_number=ticket.ticket_number,
        service_type=ticket.service_type,
        status=ticket.status.value,
        created_at=ticket.created_at,
        called_at=ticket.called_at,
        completed_at=ticket.completed_at,
    )


def next_ticket_number(db: Session, agency_id: str) -> str:
    today = datetime.now(timezone.utc).date()
    prefix = f"{today.strftime('%Y%m%d')}%"
    count = db.scalar(
        select(func.count(Ticket.id))
        .join(Ticket.visitor)
        .where(
            Visitor.agency_id == agency_id,
            Ticket.ticket_number.like(prefix),
        )
    ) or 0
    return f"{today.strftime('%Y%m%d')}-{count + 1:03d}"


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

    ticket = Ticket(
        visitor_id=visitor.id,
        ticket_number=next_ticket_number(db, visitor.agency_id),
        service_type=payload.service_type,
        status=TicketStatus.WAITING,
    )
    db.add(ticket)
    db.commit()
    ticket = db.scalar(ticket_query().where(Ticket.id == ticket.id))
    return ticket_to_response(ticket)


@router.get("/queue", response_model=list[TicketResponse], dependencies=TICKET_ROLES)
def get_queue(
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
