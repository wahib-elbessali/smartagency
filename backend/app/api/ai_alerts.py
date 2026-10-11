from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_alerts.classifier import (
    DEFAULT_WEAPON_THRESHOLD,
    WEAPON_THRESHOLD_SYNC_LOCK,
    appliquer_seuil_arme_ai,
    definir_seuil_confiance_arme,
)
from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import AIAlertThreshold, RoleName, User
from app.schemas.camera import AIWeaponThresholdRequest, AIWeaponThresholdResponse


router = APIRouter(prefix="/ai-alerts/thresholds", tags=["AI alert thresholds"])
AI_THRESHOLD_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]


def get_or_create_weapon_threshold(db: Session) -> AIAlertThreshold:
    threshold = db.scalar(
        select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "weapon")
    )
    if threshold is None:
        threshold = AIAlertThreshold(
            alert_type="weapon",
            confidence=DEFAULT_WEAPON_THRESHOLD,
        )
        db.add(threshold)
        db.commit()
        db.refresh(threshold)
    definir_seuil_confiance_arme(threshold.confidence)
    return threshold


@router.get(
    "/weapon",
    response_model=AIWeaponThresholdResponse,
    dependencies=AI_THRESHOLD_ROLES,
)
def get_weapon_threshold(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWeaponThresholdResponse:
    threshold = get_or_create_weapon_threshold(db)
    return AIWeaponThresholdResponse(confidence=threshold.confidence)


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
    with WEAPON_THRESHOLD_SYNC_LOCK:
        # The AI detector must accept the value first, as for PUT
        # /wanted/threshold: if it is unavailable or rejects it, the
        # AIClientError is turned into 503/502/4xx by the global handler and
        # nothing is written -- not even the default row get_or_create would
        # commit -- and the in-memory filter does not change.
        applied = appliquer_seuil_arme_ai(payload.confidence)
        threshold = db.scalar(
            select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "weapon")
        )
        if threshold is None:
            threshold = AIAlertThreshold(alert_type="weapon", confidence=applied)
            db.add(threshold)
        else:
            threshold.confidence = applied
        db.commit()
        db.refresh(threshold)
        definir_seuil_confiance_arme(threshold.confidence)
    return AIWeaponThresholdResponse(confidence=threshold.confidence)
