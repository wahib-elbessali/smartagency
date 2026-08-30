"""Consume the weapon-detection WebSocket exposed by the AI service."""

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone
from urllib.parse import quote
from typing import Any

import httpx
import websockets
from sqlalchemy import select

from app.ai_alerts.classifier import (
    DEFAULT_WEAPON_THRESHOLD,
    definir_seuil_confiance_arme,
    filtrer_detections_armes,
)
from app.core.config import settings
from app.database.connection import SessionLocal
from app.models.entities import (
    AIAlertThreshold,
    Alert,
    AlertSeverity,
    AlertStatus,
    Camera,
    DeviceStatus,
)


logger = logging.getLogger(__name__)


class WeaponAlertConsumer:
    """Background bridge between the AI stream and the backend database.

    Camera names are the identifiers shared by both applications. The AI
    service is site-wide, so camera names are required to be unique in the
    backend. MQTT is not involved in this flow: cameras send video to the AI
    service, and the AI service sends detection events to this consumer.
    """

    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._sync_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_sources: dict[str, str] = {}

    def start(self) -> None:
        if not settings.ai_alerts_enabled or (
            self._thread is not None and self._thread.is_alive()
        ):
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="weapon-alert-consumer",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._thread = None

    def request_sync(self) -> None:
        """Wake the next consumer cycle after a camera is created or updated."""
        self._sync_event.set()

    def _run(self) -> None:
        try:
            self._load_persisted_threshold()
            asyncio.run(self._consume_forever())
        except Exception:
            logger.exception("Le consommateur des alertes arme s est arrete")

    def _load_persisted_threshold(self) -> None:
        """Restore the last configured threshold after a backend restart."""
        db = SessionLocal()
        try:
            threshold = db.scalar(
                select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "weapon")
            )
            definir_seuil_confiance_arme(
                threshold.confidence if threshold is not None else DEFAULT_WEAPON_THRESHOLD
            )
        except Exception:
            db.rollback()
            logger.warning(
                "Seuil IA persiste indisponible; utilisation du seuil par defaut %.2f",
                DEFAULT_WEAPON_THRESHOLD,
            )
            definir_seuil_confiance_arme(DEFAULT_WEAPON_THRESHOLD)
        finally:
            db.close()

    async def _consume_forever(self) -> None:
        while not self._stop_event.is_set():
            sources = await asyncio.to_thread(self._load_sources)
            if not sources:
                await self._wait(settings.ai_reconnect_delay_seconds)
                continue

            try:
                # Re-register on every new connection. The AI service keeps
                # its source registry in memory, so it may have lost the
                # sources after an AI restart while the backend stayed up.
                await asyncio.to_thread(self._sync_sources, sources, True)
                await self._consume_stream()
            except Exception as exc:
                logger.warning("Connexion au flux IA indisponible: %s", exc)
                await asyncio.to_thread(self._mark_offline, sources)
                await self._wait(settings.ai_reconnect_delay_seconds)

    async def _wait(self, seconds: float) -> None:
        def wait_for_signal() -> None:
            deadline = time.monotonic() + seconds
            while not self._stop_event.is_set() and time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if self._sync_event.wait(timeout=min(remaining, 0.25)):
                    self._sync_event.clear()
                    return

        await asyncio.to_thread(wait_for_signal)

    def _load_sources(self) -> dict[str, str]:
        db = SessionLocal()
        try:
            cameras = db.scalars(
                select(Camera).where(Camera.stream_url.is_not(None)).order_by(Camera.name)
            ).all()
            return {camera.name: camera.stream_url for camera in cameras if camera.stream_url}
        finally:
            db.close()

    @property
    def _ai_http_base_url(self) -> str:
        return settings.ai_service_url.rstrip("/")

    @property
    def _ai_websocket_url(self) -> str:
        base = self._ai_http_base_url
        if base.startswith("https://"):
            base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            base = "ws://" + base[len("http://") :]
        return f"{base}/weapon/alerts/stream"

    def _sync_sources(self, sources: dict[str, str], force: bool = False) -> None:
        if not force and sources == self._last_sources:
            return

        with httpx.Client(timeout=5.0) as client:
            response = client.post(
                f"{self._ai_http_base_url}/weapon/sources",
                json={"sources": sources},
            )
            response.raise_for_status()

            # The AI endpoint accumulates sources. Remove only sources that
            # this backend previously registered, never unknown AI sources.
            for removed_name in set(self._last_sources) - set(sources):
                client.delete(
                    f"{self._ai_http_base_url}/weapon/sources/{quote(removed_name, safe='')}"
                )

        self._last_sources = dict(sources)
        logger.info("Sources camera synchronisees avec le service IA: %s", sorted(sources))

    async def _consume_stream(self) -> None:
        async with websockets.connect(
            self._ai_websocket_url,
            ping_interval=20,
            ping_timeout=20,
        ) as socket:
            last_sync = time.monotonic()
            while not self._stop_event.is_set():
                try:
                    raw_message = await asyncio.wait_for(
                        socket.recv(), timeout=1.0
                    )
                except asyncio.TimeoutError:
                    now = time.monotonic()
                    if (
                        self._sync_event.is_set()
                        or now - last_sync >= settings.ai_source_sync_interval_seconds
                    ):
                        self._sync_event.clear()
                        sources = await asyncio.to_thread(self._load_sources)
                        await asyncio.to_thread(self._sync_sources, sources)
                        last_sync = now
                        if not sources:
                            return
                    continue

                if raw_message is None:
                    return
                if isinstance(raw_message, bytes):
                    raw_message = raw_message.decode("utf-8")
                try:
                    message = json.loads(raw_message)
                except (TypeError, json.JSONDecodeError):
                    logger.warning("Message IA ignore: JSON invalide")
                    continue
                if not isinstance(message, dict):
                    logger.warning("Message IA ignore: objet JSON attendu")
                    continue
                self.process_message(message)

    def process_message(self, message: dict[str, Any]) -> None:
        """Process one AI snapshot/update; public for deterministic tests."""
        message_type = message.get("type")
        if message_type == "snapshot":
            cameras = message.get("cameras")
            if isinstance(cameras, dict):
                for camera_name, detections in cameras.items():
                    self._persist_camera_update(camera_name, detections)
            return

        if message_type == "update":
            camera_name = message.get("camera")
            if isinstance(camera_name, str):
                self._persist_camera_update(camera_name, message.get("detections", []))

    def _normalise_detections(self, raw_detections: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_detections, list):
            return []
        detections: list[dict[str, Any]] = []
        for raw in raw_detections:
            if not isinstance(raw, dict):
                continue
            try:
                confidence = float(raw["confidence"])
            except (KeyError, TypeError, ValueError):
                continue
            detection = {
                "class": str(raw.get("class", "weapon")),
                "confidence": confidence,
            }
            if "bbox" in raw:
                detection["bbox"] = raw["bbox"]
            detections.append(detection)
        return filtrer_detections_armes(detections)

    def _persist_camera_update(self, camera_name: Any, raw_detections: Any) -> None:
        detections = self._normalise_detections(raw_detections)
        db = SessionLocal()
        try:
            camera = db.scalar(select(Camera).where(Camera.name == camera_name))
            if camera is None:
                logger.warning("Aucune camera backend ne correspond au nom IA %r", camera_name)
                return

            camera.status = DeviceStatus.ONLINE
            open_alerts = db.scalars(
                select(Alert).where(
                    Alert.camera_id == camera.id,
                    Alert.alert_type == "weapon",
                    Alert.status.in_((AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)),
                )
            ).all()

            if detections:
                details = ", ".join(
                    f"{d['class']} ({d['confidence']:.2f})" for d in detections
                )
                alert_message = f"Arme detectee par la camera {camera.name}: {details}"
                if open_alerts:
                    for alert in open_alerts:
                        alert.message = alert_message
                        alert.severity = AlertSeverity.CRITICAL
                else:
                    db.add(
                        Alert(
                            agency_id=camera.agency_id,
                            camera_id=camera.id,
                            alert_type="weapon",
                            title="Arme detectee",
                            message=alert_message,
                            severity=AlertSeverity.CRITICAL,
                            status=AlertStatus.OPEN,
                        )
                    )
            else:
                resolved_at = datetime.now(timezone.utc)
                for alert in open_alerts:
                    alert.status = AlertStatus.RESOLVED
                    alert.resolved_at = resolved_at

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Impossible d enregistrer l alerte arme pour %r", camera_name)
        finally:
            db.close()

    def _mark_offline(self, sources: dict[str, str]) -> None:
        if not sources:
            return
        db = SessionLocal()
        try:
            cameras = db.scalars(select(Camera).where(Camera.name.in_(sources))).all()
            for camera in cameras:
                camera.status = DeviceStatus.OFFLINE
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Impossible de mettre a jour le statut des cameras")
        finally:
            db.close()


weapon_alert_consumer = WeaponAlertConsumer()
