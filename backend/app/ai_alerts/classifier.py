"""Business-level filtering for weapon detections.

This module keeps the backend threshold that decides whether a received
detection becomes an alert. It is updated immediately by the REST API and is
safe to read from the AI consumer thread.

The same value is pushed to the AI detector (``PUT /weapon/threshold``) so the
detector and this filter never disagree: the AI only pushes an update when the
set of detected classes changes, so a confidence crossing a threshold the AI
does not know about is never reported (QA WPN-02). PostgreSQL holds the value;
the AI copy lives in memory and is re-applied after every reconnection.
"""

import math
from threading import Lock
from typing import Any

from app.integrations.ai_client import AIClientError, ai_client


DEFAULT_WEAPON_THRESHOLD = 0.6
_lock = Lock()
_weapon_threshold = DEFAULT_WEAPON_THRESHOLD

# Serialises "read/write the stored threshold + push it to the AI" between the
# REST endpoint and the consumer's reconnection sync, so a reconnection cannot
# push a value that a concurrent PUT has just replaced.
WEAPON_THRESHOLD_SYNC_LOCK = Lock()


def get_seuil_confiance_arme() -> float:
    with _lock:
        return _weapon_threshold


def definir_seuil_confiance_arme(confidence: float) -> float:
    if confidence <= 0 or confidence > 1:
        raise ValueError("Le seuil doit etre strictement superieur a 0 et inferieur ou egal a 1")
    global _weapon_threshold
    with _lock:
        _weapon_threshold = float(confidence)
        return _weapon_threshold


class AIWeaponThresholdUnsupported(AIClientError):
    """The AI service predates ``PUT /weapon/threshold`` (answered 404/405).

    Lets the consumer keep alerting during a rollout where the backend is
    updated before the AI, instead of refusing to consume forever.
    """

    def __init__(self) -> None:
        super().__init__(
            "Le service AI ne prend pas encore en charge /weapon/threshold; "
            "mettez a jour le service AI",
            status_code=502,
            path="/weapon/threshold",
        )


def appliquer_seuil_arme_ai(confidence: float) -> float:
    """Push the weapon threshold to the AI detector and check it was applied.

    Raises ``AIWeaponThresholdUnsupported`` when the AI has no such route, and
    ``AIClientError`` (503 unavailable, 502 invalid answer, upstream 4xx
    preserved) when the AI does not confirm the exact value.
    """
    try:
        response = ai_client.update_weapon_threshold(confidence)
    except AIClientError as exc:
        if exc.upstream_status in (404, 405):
            raise AIWeaponThresholdUnsupported() from exc
        raise
    applied = response.get("conf") if isinstance(response, dict) else None
    if (
        not isinstance(applied, (int, float))
        or not math.isclose(float(applied), float(confidence), abs_tol=1e-9)
    ):
        raise AIClientError(
            "Reponse invalide du service AI pour le seuil des armes",
            status_code=502,
            path="/weapon/threshold",
        )
    return float(applied)


def filtrer_detections_armes(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only valid detections at or above the current business threshold."""
    threshold = get_seuil_confiance_arme()
    return [
        detection
        for detection in detections
        if isinstance(detection, dict)
        and isinstance(detection.get("confidence"), (int, float))
        and float(detection["confidence"]) >= threshold
    ]
