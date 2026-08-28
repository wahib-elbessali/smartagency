"""Sends Discord webhook notifications. Kept separate from classifier.py
(pure, no I/O) -- this module makes the network call.
"""
import logging

import requests

from app.core.config import settings


logger = logging.getLogger(__name__)


def envoyer_discord(webhook_url: str, message: str) -> None:
    response = requests.post(webhook_url, json={"content": message}, timeout=5)
    response.raise_for_status()


def dispatch(decision) -> None:
    """One notification per role in `decision.notify_roles`. Without
    DISCORD_WEBHOOK_URL configured, logs a simulated send instead of
    calling out."""
    if not decision.notify_roles:
        logger.info("[ai_alerts] rien a envoyer (%s: %s)", decision.action, decision.title)
        return

    webhook_url = settings.discord_webhook_url
    if not webhook_url:
        for role in decision.notify_roles:
            logger.info("[ai_alerts] (simule) [%s] %s -> %s", decision.action.upper(), decision.title, role)
        return

    message = f"[{decision.action.upper()}] {decision.title} -- {decision.message}"
    # All roles currently share DISCORD_WEBHOOK_URL, so a Decision with
    # several notify_roles posts the same message once per role (e.g.
    # SECURITY + MANAGER = posted twice). Intentional for now -- move to
    # one webhook per role when that's needed.
    for role in decision.notify_roles:
        try:
            envoyer_discord(webhook_url, message)
            logger.info("[ai_alerts] envoye a %s", role)
        except Exception:
            logger.exception("[ai_alerts] echec envoi Discord pour %s", role)
