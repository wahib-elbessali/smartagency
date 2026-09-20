"""Authenticated WebSocket proxies for the AI service streams.

The browser connects to the backend only.  The backend validates the access
token, removes it from the upstream query string, and relays the AI frames to
the browser.  This keeps the AI service private and prevents its unauthenticated
streams from being exposed directly to the frontend.
"""

import asyncio
import logging
from urllib.parse import parse_qsl, urlencode

import websockets
from fastapi import APIRouter, WebSocket

from app.core.config import settings
from app.core.security import decode_token
from app.models.entities import RoleName


logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI WebSocket"])

ALERT_ROLES = frozenset(
    {
        RoleName.ADMIN.value,
        RoleName.MANAGER.value,
        RoleName.SECURITY.value,
    }
)
OCCUPANCY_ROLES = frozenset(
    {
        RoleName.ADMIN.value,
        RoleName.MANAGER.value,
    }
)


def _upstream_base_url() -> str:
    """Convert the configured AI HTTP URL to its WebSocket equivalent."""
    base = settings.ai_service_url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :]
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :]
    return base


def _upstream_url(websocket: WebSocket, path: str) -> str:
    """Build an AI URL while never forwarding the frontend JWT."""
    raw_query = websocket.scope.get("query_string", b"")
    if isinstance(raw_query, bytes):
        raw_query = raw_query.decode("utf-8")
    query = urlencode(
        (key, value)
        for key, value in parse_qsl(raw_query, keep_blank_values=True)
        if key != "token"
    )
    suffix = f"?{query}" if query else ""
    return f"{_upstream_base_url()}{path}{suffix}"


def _is_authorized(websocket: WebSocket, allowed_roles: frozenset[str]) -> bool:
    token = websocket.query_params.get("token")
    if not token:
        return False
    try:
        payload = decode_token(token)
    except Exception:
        return False
    return payload.get("role") in allowed_roles


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except Exception:
        # The peer may already have closed the connection.
        pass


async def _proxy(websocket: WebSocket, upstream_path: str, allowed_roles: frozenset[str]) -> None:
    """Relay one AI stream until either side disconnects."""
    await websocket.accept()
    if not _is_authorized(websocket, allowed_roles):
        await _close(websocket, 1008)
        return

    upstream_url = _upstream_url(websocket, upstream_path)
    upstream_finished = False

    try:
        async with websockets.connect(
            upstream_url,
            ping_interval=20,
            ping_timeout=20,
        ) as upstream:

            async def relay_upstream() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            async def drain_client() -> None:
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        return

            relay_task = asyncio.create_task(relay_upstream())
            client_task = asyncio.create_task(drain_client())
            done, pending = await asyncio.wait(
                {relay_task, client_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

            for task in done:
                try:
                    task.result()
                except Exception as exc:
                    logger.debug("AI WebSocket proxy stopped: %s", exc)
            upstream_finished = relay_task in done
    except websockets.exceptions.ConnectionClosed:
        upstream_finished = True
    except Exception:
        logger.exception("AI service WebSocket unavailable: %s", upstream_url)
        await _close(websocket, 1013)
        return

    if upstream_finished:
        await _close(websocket, 1000)


@router.websocket("/ws/alerts/weapon")
async def weapon_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/weapon/alerts/stream", ALERT_ROLES)


@router.websocket("/ws/alerts/fire")
async def fire_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/fire/alerts/stream", ALERT_ROLES)


@router.websocket("/ws/alerts/emotion")
async def emotion_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/emotion/alerts/stream", ALERT_ROLES)


@router.websocket("/ws/alerts/wanted")
async def wanted_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/wanted/alerts/stream", ALERT_ROLES)


@router.websocket("/ws/occupancy")
async def occupancy_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/zoning/occupancy/stream", OCCUPANCY_ROLES)
