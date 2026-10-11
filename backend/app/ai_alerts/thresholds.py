"""Synchronisation generique des seuils d'alertes entre PostgreSQL et l'AI.

PostgreSQL (table ``ai_alert_thresholds``) est la source durable. La valeur
active dans le service AI est appliquee par ``PATCH /config`` avec
``persist=false``: elle est perdue au redemarrage de l'AI, puis restauree par
le consommateur de la feature a sa reconnexion.

Chaque seuil est independant: une mise a jour n'envoie que la cle AI de sa
propre feature, et chaque feature a son propre verrou.
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_alerts.classifier import (
    DEFAULT_WEAPON_THRESHOLD,
    definir_seuil_confiance_arme,
)
from app.database.connection import SessionLocal
from app.integrations.ai_client import (
    AIClient,
    AIClientError,
    AIServiceUnavailable,
    ai_client,
)
from app.models.entities import AIAlertThreshold


logger = logging.getLogger(__name__)

# Meme plancher que THRESHOLD_FLOOR du moteur wanted de l'AI: en dessous,
# la reconnaissance en ensemble ouvert produit des fausses alertes en continu.
WANTED_THRESHOLD_FLOOR = 0.25


@dataclass(frozen=True)
class ThresholdSpec:
    alert_type: str
    section: str
    key: str
    minimum: float
    minimum_inclusive: bool
    # None: tant qu'aucune valeur n'est enregistree, config.json de l'AI fait foi.
    default: float | None
    # Copie memoire cote backend a garder alignee (filtre de securite weapon).
    on_applied: Callable[[float], Any] | None = None


THRESHOLDS: dict[str, ThresholdSpec] = {
    "weapon": ThresholdSpec(
        alert_type="weapon",
        section="weapon",
        key="conf",
        minimum=0.0,
        minimum_inclusive=False,
        default=DEFAULT_WEAPON_THRESHOLD,
        on_applied=definir_seuil_confiance_arme,
    ),
    "fire": ThresholdSpec(
        alert_type="fire",
        section="fire",
        key="conf",
        minimum=0.0,
        minimum_inclusive=False,
        default=None,
    ),
    "wanted": ThresholdSpec(
        alert_type="wanted",
        section="wanted",
        key="threshold",
        minimum=WANTED_THRESHOLD_FLOOR,
        minimum_inclusive=True,
        default=None,
    ),
}

_locks = {alert_type: threading.Lock() for alert_type in THRESHOLDS}


def _spec(alert_type: str) -> ThresholdSpec:
    try:
        return THRESHOLDS[alert_type]
    except KeyError:
        raise ValueError(f"Type de seuil non supporte: {alert_type!r}") from None


@contextmanager
def threshold_lock(alert_type: str) -> Iterator[None]:
    """Serialise la mise a jour et la restauration d'un meme seuil."""
    _spec(alert_type)
    with _locks[alert_type]:
        yield


def validate_threshold(alert_type: str, value: Any) -> float:
    """Applique les memes bornes que l'AI, avant tout appel reseau."""
    spec = _spec(alert_type)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Le seuil {alert_type} doit etre un nombre")
    value = float(value)
    too_low = value < spec.minimum or (
        value == spec.minimum and not spec.minimum_inclusive
    )
    if not math.isfinite(value) or too_low or value > 1:
        bracket = "[" if spec.minimum_inclusive else "]"
        raise ValueError(
            f"Le seuil {alert_type} doit etre dans {bracket}{spec.minimum}, 1]"
        )
    return value


def _get_row(db: Session, alert_type: str) -> AIAlertThreshold | None:
    return db.scalar(
        select(AIAlertThreshold).where(AIAlertThreshold.alert_type == alert_type)
    )


def get_threshold(db: Session, alert_type: str) -> float | None:
    """Valeur persistee, sinon le defaut de la feature. Sans effet de bord."""
    row = _get_row(db, alert_type)
    return row.confidence if row is not None else _spec(alert_type).default


def store_threshold(db: Session, alert_type: str, value: float) -> AIAlertThreshold:
    """Prepare l'ecriture de la valeur; l'appelant commit."""
    row = _get_row(db, alert_type)
    if row is None:
        row = AIAlertThreshold(alert_type=alert_type, confidence=value)
        db.add(row)
    else:
        row.confidence = value
    db.flush()
    return row


def _apply_backend_mirror(spec: ThresholdSpec, value: float) -> None:
    if spec.on_applied is not None:
        spec.on_applied(value)


def _config_value(response: Any, part: str, spec: ThresholdSpec) -> Any:
    """Lit ``response[part][section][key]`` d'une reponse PATCH /config."""
    value = response
    for name in (part, spec.section, spec.key):
        if not isinstance(value, dict):
            return None
        value = value.get(name)
    return value


def _push_to_ai(spec: ThresholdSpec, value: float, client: AIClient) -> Any:
    """Envoie uniquement la cle de cette feature et verifie sa prise en compte."""
    response = client.patch_config({spec.section: {spec.key: value}}, persist=False)
    applied = _config_value(response, "applied", spec)
    if not isinstance(applied, dict) or applied.get("value") != value:
        logger.error(
            "Reponse PATCH /config inattendue pour %s.%s: %r",
            spec.section,
            spec.key,
            response,
        )
        raise AIClientError(
            "Le service AI a retourne une reponse invalide",
            status_code=502,
            path="/config",
        )
    return response


def _restore_ai(spec: ThresholdSpec, previous_ai_value: Any, client: AIClient) -> None:
    """Remet l'AI a sa valeur precedente quand la base n'a pas pu suivre."""
    if previous_ai_value is None:
        return
    try:
        client.patch_config({spec.section: {spec.key: previous_ai_value}}, persist=False)
    except Exception as exc:
        logger.error(
            "Seuil %s: base non mise a jour et AI non restauree (%s); "
            "restauration a la prochaine reconnexion",
            spec.alert_type,
            exc,
        )


def restore_ai_threshold(
    alert_type: str,
    previous_ai_value: Any,
    *,
    client: AIClient | None = None,
) -> None:
    """Compensation publique quand l'ecriture en base echoue apres l'AI."""
    _restore_ai(_spec(alert_type), previous_ai_value, client or ai_client)


def commit_threshold(
    db: Session,
    alert_type: str,
    value: float,
    *,
    previous_ai_value: Any = None,
    client: AIClient | None = None,
) -> None:
    """Commit une valeur deja acceptee par l'AI, puis aligne le miroir backend.

    Si le commit echoue, l'AI est remise a sa valeur precedente (au mieux);
    sinon la prochaine reconnexion du consommateur la restaurera depuis la base.
    """
    spec = _spec(alert_type)
    try:
        db.commit()
    except Exception:
        db.rollback()
        _restore_ai(spec, previous_ai_value, client or ai_client)
        raise
    _apply_backend_mirror(spec, value)


def update_threshold(
    db: Session,
    alert_type: str,
    value: Any,
    *,
    client: AIClient | None = None,
) -> float:
    """Valide, applique a l'AI, puis persiste. Rien n'est enregistre si l'AI refuse."""
    spec = _spec(alert_type)
    value = validate_threshold(alert_type, value)
    client = client or ai_client
    with threshold_lock(alert_type):
        response = _push_to_ai(spec, value, client)
        previous_ai_value = _config_value(response, "previous", spec)
        try:
            store_threshold(db, alert_type, value)
        except Exception:
            db.rollback()
            _restore_ai(spec, previous_ai_value, client)
            raise
        commit_threshold(
            db,
            alert_type,
            value,
            previous_ai_value=previous_ai_value,
            client=client,
        )
    return value


def sync_thresholds(
    alert_types: Iterable[str],
    *,
    client: AIClient | None = None,
) -> bool:
    """Re-applique a l'AI les seuils persistes des features demandees.

    Retourne False si l'AI ou la base est indisponible, pour que le
    consommateur reessaie avec son delai de reconnexion habituel. Toute autre
    erreur AI (refus, 5xx, reponse invalide) est journalisee sans bloquer le
    flux d'alertes: le filtre backend garde la valeur persistee et la
    prochaine reconnexion retentera la restauration.
    """
    client = client or ai_client
    for alert_type in alert_types:
        spec = THRESHOLDS.get(alert_type)
        if spec is None:
            continue
        with threshold_lock(alert_type):
            db = SessionLocal()
            try:
                value = get_threshold(db, alert_type)
            except Exception:
                logger.warning("Seuil %s persiste indisponible", alert_type)
                return False
            finally:
                db.close()
            if value is None:
                continue

            try:
                value = validate_threshold(alert_type, value)
            except ValueError as exc:
                logger.error("Seuil %s persiste ignore: %s", alert_type, exc)
                continue
            _apply_backend_mirror(spec, value)

            try:
                _push_to_ai(spec, value, client)
            except AIServiceUnavailable as exc:
                logger.warning("Seuil %s non restaure dans l'AI: %s", alert_type, exc)
                return False
            except AIClientError as exc:
                logger.error("Seuil %s non restaure dans l'AI: %s", alert_type, exc)
    return True
