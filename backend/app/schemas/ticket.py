from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TicketCreate(BaseModel):
    visitor_id: str
    service_type: str | None = Field(default=None, max_length=100)


class TicketCallRequest(BaseModel):
    counter_id: str


class TicketResponse(BaseModel):
    id: str
    visitor_id: str
    visitor_name: str
    agency_id: str
    counter_id: str | None
    ticket_number: str
    service_type: str | None
    status: Literal["WAITING", "CALLED", "IN_SERVICE", "COMPLETED", "CANCELLED"]
    created_at: datetime
    called_at: datetime | None
    completed_at: datetime | None
