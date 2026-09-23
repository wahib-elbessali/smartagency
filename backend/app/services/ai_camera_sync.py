"""Synchronise les cameras PostgreSQL avec le registre du service AI."""

from __future__ import annotations

import logging
import threading

from sqlalchemy import select

from app.core.config import settings
from app.database.connection import SessionLocal
from app.integrations.ai_client import AIClient, AIClientError, ai_client
from app.models.entities import Camera, DeviceStatus


logger = logging.getLogger(__name__)

# Les deux cameras de l'agence sont preparees pour tous les modules AI. Les
# modules ne demarrent effectivement que lorsque leur configuration est
# complete (calibration, zones, watchlist, etc.).
AI_CAMERA_FEATURES = (
    "people",
    "zoning",
    "weapon",
    "fire",
    "emotion",
    "wanted",
)


class AICameraSyncService:
    """Maintient le registre AI aligne sur la table backend ``cameras``."""

    def __init__(self, client: AIClient | None = None) -> None:
        self.client = client or ai_client
        self._stop_event = threading.Event()
        self._sync_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Lance la reconciliation periodique en arriere-plan."""
        if not settings.ai_alerts_enabled or (
            self._thread is not None and self._thread.is_alive()
        ):
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="ai-camera-sync",
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
        """Reveille la reconciliation apres une modification de camera."""
        self._sync_event.set()

    def sync_camera(self, camera: Camera, previous_name: str | None = None) -> bool:
        """Synchronise une camera deja enregistree dans PostgreSQL.

        Le statut SQLAlchemy est modifie par cette methode ; l'appelant garde
        la responsabilite de valider sa transaction avec ``db.commit()``.
        """
        if previous_name and previous_name != camera.name:
            self._delete_from_ai(previous_name)

        if not camera.stream_url:
            self._delete_from_ai(camera.name)
            camera.status = DeviceStatus.OFFLINE
            self.request_sync()
            return False

        try:
            self.client.create_camera(
                camera.name,
                url=camera.stream_url,
                name=camera.name,
                quality=1.0,
                features=AI_CAMERA_FEATURES,
            )
        except AIClientError as exc:
            camera.status = DeviceStatus.OFFLINE
            logger.warning(
                "Camera %s non synchronisee avec AI: %s",
                camera.name,
                exc.detail,
            )
            self.request_sync()
            return False
        except Exception:
            camera.status = DeviceStatus.OFFLINE
            logger.exception("Erreur inattendue de synchronisation de la camera %s", camera.name)
            self.request_sync()
            return False

        camera.status = DeviceStatus.ONLINE
        return True

    def delete_camera(self, camera_name: str) -> bool:
        """Supprime une camera du registre AI sans bloquer la suppression SQL."""
        deleted = self._delete_from_ai(camera_name)
        self.request_sync()
        return deleted

    def sync_all(self) -> bool:
        """Reconcile toutes les cameras backend avec le registre AI.

        Le backend est la source de verite. Dans le contexte actuel d'une seule
        agence, les cameras AI absentes de PostgreSQL sont supprimees du
        registre AI pour eviter les sources orphelines apres un redemarrage.
        """
        db = SessionLocal()
        try:
            cameras = list(db.scalars(select(Camera).order_by(Camera.name)).all())
            try:
                ai_registry = self.client.list_cameras()
                existing_ids = self._extract_ai_camera_ids(ai_registry)
            except AIClientError as exc:
                for camera in cameras:
                    camera.status = DeviceStatus.OFFLINE
                db.commit()
                logger.warning("Synchronisation AI impossible: %s", exc.detail)
                return False

            desired_ids = {
                camera.name for camera in cameras if camera.stream_url
            }
            all_ok = True

            for camera in cameras:
                if not self.sync_camera(camera):
                    all_ok = False

            for stale_id in existing_ids - desired_ids:
                if not self._delete_from_ai(stale_id):
                    all_ok = False

            db.commit()
            return all_ok
        except Exception:
            db.rollback()
            logger.exception("Erreur pendant la reconciliation des cameras AI")
            return False
        finally:
            db.close()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self.sync_all()
            self._sync_event.wait(timeout=settings.ai_source_sync_interval_seconds)
            self._sync_event.clear()

    def _delete_from_ai(self, camera_name: str) -> bool:
        try:
            self.client.delete_camera(camera_name)
            return True
        except AIClientError as exc:
            logger.warning(
                "Camera %s non supprimee du registre AI: %s",
                camera_name,
                exc.detail,
            )
            return False
        except Exception:
            logger.exception("Erreur inattendue lors de la suppression AI de %s", camera_name)
            return False

    @staticmethod
    def _extract_ai_camera_ids(payload: object) -> set[str]:
        if not isinstance(payload, dict) or not isinstance(payload.get("cameras"), dict):
            raise AIClientError(
                "Le service AI a retourne un registre de cameras invalide",
                status_code=502,
                path="/cameras",
            )
        return {str(camera_id) for camera_id in payload["cameras"]}


ai_camera_sync = AICameraSyncService()
