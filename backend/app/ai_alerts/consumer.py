"""Consommateurs generiques des flux d'alertes AI.

Les modules weapon, fire et emotion exposent le meme flux WebSocket. Cette
implementation commune synchronise leurs sources, interprete les snapshots et
updates, puis persiste les alertes dans PostgreSQL. Les WebSockets backend
existants continuent de relayer les frames AI au frontend en temps reel.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import websockets
from sqlalchemy import select

from app.ai_alerts.classifier import (
    DEFAULT_WEAPON_THRESHOLD,
    definir_seuil_confiance_arme,
    filtrer_detections_armes,
)
from app.core.config import settings
from app.database.connection import SessionLocal
from app.integrations.ai_client import ai_client
from app.models.entities import (
    AIAlertThreshold,
    Alert,
    AlertSeverity,
    AlertStatus,
    AuditLog,
    Camera,
    DeviceStatus,
)
from app.services.ai_source_sync import AISourceSyncService, ai_source_sync


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AIAlertFeature:
    key: str
    title: str
    message_prefix: str
    severity: AlertSeverity
    default_class: str


AI_ALERT_FEATURES = {
    "weapon": AIAlertFeature(
        key="weapon",
        title="Arme detectee",
        message_prefix="Arme detectee",
        severity=AlertSeverity.CRITICAL,
        default_class="weapon",
    ),
    "fire": AIAlertFeature(
        key="fire",
        title="Feu detecte",
        message_prefix="Feu detecte",
        severity=AlertSeverity.CRITICAL,
        default_class="fire",
    ),
    "emotion": AIAlertFeature(
        key="emotion",
        title="Emotion detectee",
        message_prefix="Emotion detectee",
        severity=AlertSeverity.MEDIUM,
        default_class="emotion",
    ),
    "wanted": AIAlertFeature(
        key="wanted",
        title="Personne surveillee detectee",
        message_prefix="Personne surveillee detectee",
        severity=AlertSeverity.HIGH,
        default_class="wanted",
    ),
}


class AIAlertConsumer:
    """Bridge entre un flux WebSocket AI et les alertes backend."""

    def __init__(
        self,
        feature: AIAlertFeature,
        *,
        source_sync: AISourceSyncService | None = None,
    ) -> None:
        self.feature = feature
        self.source_sync = source_sync or ai_source_sync
        self._stop_event = threading.Event()
        self._sync_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def feature_name(self) -> str:
        return self.feature.key

    @property
    def _ai_websocket_url(self) -> str:
        return ai_client.websocket_url(f"/{self.feature.key}/alerts/stream")

    def start(self) -> None:
        if not settings.ai_alerts_enabled or (
            self._thread is not None and self._thread.is_alive()
        ):
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f"{self.feature.key}-alert-consumer",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._sync_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._thread = None

    def request_sync(self) -> None:
        """Reveille le cycle apres une creation, modification ou suppression."""
        self._sync_event.set()

    def _run(self) -> None:
        try:
            if self.feature_name == "weapon":
                self._load_persisted_weapon_threshold()
            elif self.feature_name == "wanted":
                self._apply_persisted_wanted_threshold()
            asyncio.run(self._consume_forever())
        except Exception:
            logger.exception(
                "Le consommateur des alertes %s s est arrete", self.feature_name
            )

    def _load_persisted_weapon_threshold(self) -> None:
        """Restaure le seuil metier des armes apres un redemarrage."""
        db = SessionLocal()
        try:
            threshold = db.scalar(
                select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "weapon")
            )
            definir_seuil_confiance_arme(
                threshold.confidence
                if threshold is not None
                else DEFAULT_WEAPON_THRESHOLD
            )
        except Exception:
            db.rollback()
            logger.warning(
                "Seuil IA des armes indisponible; seuil par defaut %.2f utilise",
                DEFAULT_WEAPON_THRESHOLD,
            )
            definir_seuil_confiance_arme(DEFAULT_WEAPON_THRESHOLD)
        finally:
            db.close()

    # Nom conserve pour les integrations internes qui utilisaient encore le
    # consommateur weapon avant sa generalisation.
    def _load_persisted_threshold(self) -> None:
        self._load_persisted_weapon_threshold()

    def _apply_persisted_wanted_threshold(self) -> None:
        """Re-applique le seuil wanted persiste par le backend si disponible."""
        db = SessionLocal()
        try:
            threshold = db.scalar(
                select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "wanted")
            )
            if threshold is not None:
                try:
                    ai_client.update_wanted_threshold({"threshold": threshold.confidence})
                except Exception as exc:
                    logger.warning("Seuil wanted non reapplique au service AI: %s", exc)
        except Exception:
            db.rollback()
            logger.warning("Seuil wanted persiste indisponible")
        finally:
            db.close()

    async def _consume_forever(self) -> None:
        while not self._stop_event.is_set():
            sources = await asyncio.to_thread(self._load_sources)
            if not sources:
                await self._wait(settings.ai_reconnect_delay_seconds)
                continue

            try:
                # Le registre AI est en memoire: on republie apres chaque
                # reconnexion pour recuperer un redemarrage du service AI.
                synced = await asyncio.to_thread(self._sync_sources, sources, True)
                if not synced:
                    await self._wait(settings.ai_reconnect_delay_seconds)
                    continue
                await self._consume_stream()
            except Exception as exc:
                logger.warning(
                    "Connexion au flux AI %s indisponible: %s",
                    self.feature_name,
                    exc,
                )
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
            return {
                camera.name: camera.stream_url
                for camera in cameras
                if camera.stream_url
            }
        finally:
            db.close()

    def _sync_sources(self, sources: dict[str, str], force: bool = False) -> bool:
        return self.source_sync.sync(self.feature_name, sources, force=force)

    async def _consume_stream(self) -> None:
        async with websockets.connect(
            self._ai_websocket_url,
            ping_interval=20,
            ping_timeout=20,
        ) as socket:
            last_sync = time.monotonic()
            while not self._stop_event.is_set():
                try:
                    raw_message = await asyncio.wait_for(socket.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    now = time.monotonic()
                    if (
                        self._sync_event.is_set()
                        or now - last_sync >= settings.ai_source_sync_interval_seconds
                    ):
                        self._sync_event.clear()
                        sources = await asyncio.to_thread(self._load_sources)
                        if not await asyncio.to_thread(self._sync_sources, sources):
                            return
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
                    logger.warning(
                        "Message AI %s ignore: JSON invalide", self.feature_name
                    )
                    continue
                if not isinstance(message, dict):
                    logger.warning(
                        "Message AI %s ignore: objet JSON attendu", self.feature_name
                    )
                    continue
                self.process_message(message)

    def process_message(self, message: dict[str, Any]) -> None:
        """Traite un snapshot ou une mise a jour; public pour les tests."""
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
            if not math.isfinite(confidence):
                continue
            detection = {
                "class": str(raw.get("class", self.feature.default_class)),
                "confidence": confidence,
            }
            if "bbox" in raw:
                detection["bbox"] = raw["bbox"]
            detections.append(detection)

        if self.feature_name == "weapon":
            return filtrer_detections_armes(detections)
        return detections

    def _persist_camera_update(self, camera_name: Any, raw_detections: Any) -> None:
        detections = self._normalise_detections(raw_detections)
        db = SessionLocal()
        try:
            camera = db.scalar(select(Camera).where(Camera.name == camera_name))
            if camera is None:
                logger.warning(
                    "Aucune camera backend ne correspond au nom AI %r (%s)",
                    camera_name,
                    self.feature_name,
                )
                return

            camera.status = DeviceStatus.ONLINE
            open_alerts = db.scalars(
                select(Alert).where(
                    Alert.camera_id == camera.id,
                    Alert.alert_type == self.feature_name,
                    Alert.status.in_((AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)),
                )
            ).all()

            if detections:
                details = ", ".join(
                    f"{d['class']} ({d['confidence']:.2f})" for d in detections
                )
                alert_message = (
                    f"{self.feature.message_prefix} par la camera "
                    f"{camera.name}: {details}"
                )
                if open_alerts:
                    for alert in open_alerts:
                        alert.message = alert_message
                        alert.severity = self.feature.severity
                else:
                    alert = Alert(
                        agency_id=camera.agency_id,
                        camera_id=camera.id,
                        alert_type=self.feature_name,
                        title=self.feature.title,
                        message=alert_message,
                        severity=self.feature.severity,
                        status=AlertStatus.OPEN,
                    )
                    db.add(alert)
                    if self.feature_name == "wanted":
                        db.flush()
                        db.add(
                            AuditLog(
                                user_id=None,
                                agency_id=camera.agency_id,
                                action="AI_WANTED_ALERT_OPEN",
                                entity_type="Alert",
                                entity_id=alert.id,
                                details={
                                    "camera_id": camera.id,
                                    "alert_type": self.feature_name,
                                    "detections_count": len(detections),
                                },
                            )
                        )
            else:
                resolved_at = datetime.now(timezone.utc)
                for alert in open_alerts:
                    alert.status = AlertStatus.RESOLVED
                    alert.resolved_at = resolved_at
                if self.feature_name == "wanted" and open_alerts:
                    db.add(
                        AuditLog(
                            user_id=None,
                            agency_id=camera.agency_id,
                            action="AI_WANTED_ALERT_RESOLVED",
                            entity_type="Alert",
                            entity_id=open_alerts[0].id,
                            details={
                                "camera_id": camera.id,
                                "alert_type": self.feature_name,
                                "resolved_count": len(open_alerts),
                            },
                        )
                    )

            db.commit()
        except Exception:
            db.rollback()
            logger.exception(
                "Impossible d enregistrer l alerte %s pour %r",
                self.feature_name,
                camera_name,
            )
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


class WeaponAlertConsumer(AIAlertConsumer):
    """Compatibilite avec les imports historiques du consommateur weapon."""

    def __init__(self, *, source_sync: AISourceSyncService | None = None) -> None:
        super().__init__(AI_ALERT_FEATURES["weapon"], source_sync=source_sync)


class FireAlertConsumer(AIAlertConsumer):
    """Consommateur du flux de detection incendie."""

    def __init__(self, *, source_sync: AISourceSyncService | None = None) -> None:
        super().__init__(AI_ALERT_FEATURES["fire"], source_sync=source_sync)


class EmotionAlertConsumer(AIAlertConsumer):
    """Consommateur du flux d'analyse emotionnelle."""

    def __init__(self, *, source_sync: AISourceSyncService | None = None) -> None:
        super().__init__(AI_ALERT_FEATURES["emotion"], source_sync=source_sync)


class WantedAlertConsumer(AIAlertConsumer):
    """Consommateur des correspondances avec la liste de surveillance."""

    def __init__(self, *, source_sync: AISourceSyncService | None = None) -> None:
        super().__init__(AI_ALERT_FEATURES["wanted"], source_sync=source_sync)


class AIAlertConsumerManager:
    """Demarre et arrete les consommateurs des modules alertes supportes."""

    def __init__(self, consumers: list[AIAlertConsumer]) -> None:
        self.consumers = consumers

    def start(self) -> None:
        for consumer in self.consumers:
            consumer.start()

    def stop(self) -> None:
        for consumer in self.consumers:
            consumer.stop()

    def request_sync(self) -> None:
        for consumer in self.consumers:
            consumer.request_sync()


weapon_alert_consumer = WeaponAlertConsumer()
fire_alert_consumer = FireAlertConsumer()
emotion_alert_consumer = EmotionAlertConsumer()
wanted_alert_consumer = WantedAlertConsumer()
ai_alert_consumers = AIAlertConsumerManager(
    [
        weapon_alert_consumer,
        fire_alert_consumer,
        emotion_alert_consumer,
        wanted_alert_consumer,
    ]
)
