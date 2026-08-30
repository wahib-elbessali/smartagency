import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Device, Ticket, Visitor
from app.mqtt.sensor_consumer import sensor_consumer
from app.mqtt.topics import TICKET_CALLED_TOPIC


logger = logging.getLogger(__name__)


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


def publish_ticket_called(db: Session, ticket: Ticket) -> None:
    """Notify every queue display configured in the ticket's agency.

    This function is called only after the ticket state has been committed.
    MQTT is best-effort: a broker/device outage is logged, while the already
    successful ticket call remains successful for the HTTP client.
    """
    if ticket.service is None:
        logger.warning("Ticket %s has no service; ticket-called was not published", ticket.id)
        return

    displays = db.scalars(
        select(Device).where(
            Device.agency_id == ticket.visitor.agency_id,
            func.upper(Device.device_type) == "QUEUE_DISPLAY",
        )
    ).all()

    payload = {
        "service_code": ticket.service.code,
        "ticket_number": ticket.ticket_number,
    }

    if not displays:
        logger.warning(
            "No QUEUE_DISPLAY device configured for agency %s; ticket-called was not published",
            ticket.visitor.agency_id,
        )
        return

    for display in displays:
        topic = TICKET_CALLED_TOPIC.format(
            agency_id=ticket.visitor.agency_id,
            device_id=display.mqtt_client_id,
        )
        if not sensor_consumer.publish_command(topic, payload):
            logger.warning("Unable to publish ticket-called notification to %s", topic)
