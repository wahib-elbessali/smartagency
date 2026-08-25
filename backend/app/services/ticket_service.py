from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Ticket, Visitor


def next_ticket_number(db: Session, agency_id: str, service_id: str, service_code: str) -> str:
    today = datetime.now(timezone.utc).date()
    prefix = f"{today.strftime('%Y%m%d')}%"
    count = db.scalar(
        select(func.count(Ticket.id))
        .join(Ticket.visitor)
        .where(
            Visitor.agency_id == agency_id,
            Ticket.service_id == service_id,
            Ticket.ticket_number.like(prefix),
        )
    ) or 0
    return f"{today.strftime('%Y%m%d')}-{service_code[:10]}-{count + 1:03d}"
