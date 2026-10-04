from datetime import datetime

from pydantic import BaseModel

from app.models.entities import AlertSeverity, AlertStatus


class AlertResponse(BaseModel):
    id: str
    agency_id: str
    camera_id: str | None
    camera_name: str | None
    alert_type: str
    severity: AlertSeverity
    status: AlertStatus
    created_at: datetime
    resolved_at: datetime | None
