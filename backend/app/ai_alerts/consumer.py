"""Consumes the `ai/` service's alert WebSockets and writes Alert rows +
notifications.

Separate from the live-display proxy at /ws/alerts/{feature} (Ahmed's,
relays frames to the frontend verbatim) -- both are independent clients of
the same ai/ streams.

One asyncio task per feature (weapon/fire/wanted), each with its own
reconnect loop, so one feature's stream dropping doesn't affect the others.
"""
import asyncio
import json
import logging

import websockets
from websockets.exceptions import ConnectionClosed

from app.core.config import settings
from app.database.connection import SessionLocal
from app.models.entities import Alert, AlertSeverity, AlertStatus, Camera
from app.ai_alerts import notifier
from app.ai_alerts.classifier import classify

logger = logging.getLogger(__name__)

FEATURES = ("weapon", "fire", "wanted")
RECONNECT_DELAY_S = 5


def _resolve_camera_id(db, camera_label: str, agency_id: str) -> str | None:
    """Best-effort lookup of a Camera row by ai/'s free-text label. None if
    no match -- the alert is still recorded, just without the FK."""
    camera = db.query(Camera).filter(
        Camera.agency_id == agency_id, Camera.name == camera_label
    ).first()
    return camera.id if camera else None


def _handle_frame(feature: str, frame: dict) -> None:
    """One frame from an ai/ alerts stream -> zero or more Alert rows.
    Empty `detections` is the all-clear. Each detection is classified
    independently (duplicate classes are legal)."""
    if settings.default_agency_id is None:
        logger.warning("[ai_alerts] DEFAULT_AGENCY_ID non configure -- alerte ignoree (%s)", feature)
        return

    if frame.get("type") == "snapshot":
        per_camera = frame.get("cameras", {})
    elif frame.get("type") == "update":
        per_camera = {frame["camera"]: frame.get("detections", [])}
    else:
        return

    for camera_label, detections in per_camera.items():
        for detection in detections:
            decision = classify(feature, detection, camera_label)
            if decision is None:
                continue
            with SessionLocal() as db:
                alert = Alert(
                    agency_id=settings.default_agency_id,
                    camera_id=_resolve_camera_id(db, camera_label, settings.default_agency_id),
                    alert_type=f"{feature}_detected",
                    title=decision.title,
                    message=decision.message,
                    severity=AlertSeverity(decision.severity),
                    status=AlertStatus.OPEN,
                )
                db.add(alert)
                db.commit()
            notifier.dispatch(decision)


async def _watch_feature(feature: str, stop_event: asyncio.Event) -> None:
    url = f"{settings.ai_service_ws_url}/{feature}/alerts/stream"
    while not stop_event.is_set():
        try:
            async with websockets.connect(url) as ws:
                logger.info("[ai_alerts] connecte a %s", url)
                async for raw in ws:
                    try:
                        frame = json.loads(raw)
                    except ValueError:
                        continue
                    try:
                        _handle_frame(feature, frame)
                    except Exception:
                        logger.exception("[ai_alerts] echec traitement frame (%s)", feature)
        except (ConnectionClosed, OSError) as e:
            logger.warning("[ai_alerts] connexion perdue (%s): %s -- retry dans %ss", feature, e, RECONNECT_DELAY_S)
        except Exception:
            logger.exception("[ai_alerts] erreur inattendue (%s)", feature)
        if not stop_event.is_set():
            await asyncio.sleep(RECONNECT_DELAY_S)


class AiAlertsConsumer:
    def __init__(self) -> None:
        self._tasks: list[asyncio.Task] = []
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        if self._tasks:
            return
        self._stop_event.clear()
        self._tasks = [
            asyncio.create_task(_watch_feature(feature, self._stop_event)) for feature in FEATURES
        ]
        logger.info("AI alerts consumer started (%s)", ", ".join(FEATURES))

    async def stop(self) -> None:
        self._stop_event.set()
        for task in self._tasks:
            task.cancel()
        self._tasks = []


ai_alerts_consumer = AiAlertsConsumer()
