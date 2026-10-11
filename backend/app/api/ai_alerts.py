from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.ai_alerts.thresholds import get_threshold, update_threshold
from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import RoleName, User
from app.schemas.camera import AIWeaponThresholdRequest, AIWeaponThresholdResponse


router = APIRouter(prefix="/ai-alerts/thresholds", tags=["AI alert thresholds"])
AI_THRESHOLD_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]


@router.get(
    "/weapon",
    response_model=AIWeaponThresholdResponse,
    dependencies=AI_THRESHOLD_ROLES,
)
def get_weapon_threshold(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWeaponThresholdResponse:
    return AIWeaponThresholdResponse(confidence=get_threshold(db, "weapon"))


@router.put(
    "/weapon",
    response_model=AIWeaponThresholdResponse,
    dependencies=AI_THRESHOLD_ROLES,
)
def update_weapon_threshold(
    payload: AIWeaponThresholdRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWeaponThresholdResponse:
    # AI weapon.conf d'abord, puis la base et le filtre backend.
    confidence = update_threshold(db, "weapon", payload.confidence)
    return AIWeaponThresholdResponse(confidence=confidence)
