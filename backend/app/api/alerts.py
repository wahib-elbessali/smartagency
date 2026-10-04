from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, joinedload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Agency, Alert, RoleName, User
from app.schemas.alert import AlertResponse


router = APIRouter(prefix="/agencies/{agency_id}/alerts", tags=["Alerts"])
ALERT_READ_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]


@router.get("", response_model=list[AlertResponse], dependencies=ALERT_READ_ROLES)
def list_alerts(
    agency_id: str,
    alert_type: str | None = Query(default=None, min_length=1, max_length=80),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AlertResponse]:
    agency = db.get(Agency, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")

    query = (
        select(Alert)
        .options(joinedload(Alert.camera))
        .where(Alert.agency_id == agency_id)
        .order_by(desc(Alert.created_at))
    )
    if alert_type is not None:
        query = query.where(Alert.alert_type == alert_type)

    alerts = db.scalars(query).all()
    return [
        AlertResponse(
            id=alert.id,
            agency_id=alert.agency_id,
            camera_id=alert.camera_id,
            camera_name=alert.camera.name if alert.camera is not None else None,
            alert_type=alert.alert_type,
            severity=alert.severity,
            status=alert.status,
            created_at=alert.created_at,
            resolved_at=alert.resolved_at,
        )
        for alert in alerts
    ]
