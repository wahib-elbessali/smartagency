"""Synchronise les sources de cameras avec les modules d'alertes AI.

Les modules weapon, fire et emotion exposent tous le meme contrat REST:
``POST /{feature}/sources`` puis ``DELETE /{feature}/sources/{camera}``.
Ce service centralise cette logique afin que les consommateurs n'aient pas
chacun une implementation legerement differente.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Mapping
from urllib.parse import quote

from app.integrations.ai_client import AIClient, AIClientError, ai_client


logger = logging.getLogger(__name__)

SUPPORTED_ALERT_FEATURES = frozenset({"weapon", "fire", "emotion", "wanted"})


class AISourceSyncService:
    """Maintient une copie du registre de sources pour chaque module AI."""

    def __init__(self, client: AIClient | None = None) -> None:
        self.client = client or ai_client
        self._last_sources: dict[str, dict[str, str]] = {
            feature: {} for feature in SUPPORTED_ALERT_FEATURES
        }
        self._lock = threading.RLock()

    def sync(
        self,
        feature: str,
        sources: Mapping[str, str],
        *,
        force: bool = False,
    ) -> bool:
        """Enregistre les sources d'un module et retire ses sources obsoletes.

        ``force=True`` est utilise apres une reconnexion, car le registre du
        service AI est conserve en memoire et peut avoir ete perdu apres son
        redemarrage.
        """
        self._validate_feature(feature)
        desired = {str(name): str(url) for name, url in sources.items() if url}

        with self._lock:
            previous = self._last_sources[feature]
            if not force and desired == previous:
                return True

            try:
                self.client.post(f"/{feature}/sources", payload={"sources": desired})
                for removed_name in set(previous) - set(desired):
                    self.client.delete(
                        f"/{feature}/sources/{quote(removed_name, safe='')}"
                    )
            except AIClientError as exc:
                logger.warning(
                    "Sources %s non synchronisees avec AI: %s", feature, exc.detail
                )
                return False
            except Exception:
                logger.exception(
                    "Erreur inattendue de synchronisation des sources %s", feature
                )
                return False

            self._last_sources[feature] = dict(desired)
            logger.info(
                "Sources %s synchronisees avec le service AI: %s",
                feature,
                sorted(desired),
            )
            return True

    def invalidate(self, feature: str | None = None) -> None:
        """Force une nouvelle publication au prochain cycle de synchronisation."""
        with self._lock:
            if feature is None:
                for name in self._last_sources:
                    self._last_sources[name] = {}
            else:
                self._validate_feature(feature)
                self._last_sources[feature] = {}

    @staticmethod
    def _validate_feature(feature: str) -> None:
        if feature not in SUPPORTED_ALERT_FEATURES:
            raise ValueError(f"Module AI non supporte: {feature}")


ai_source_sync = AISourceSyncService()
