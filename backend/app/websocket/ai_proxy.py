"""Authenticated WebSocket proxies for the AI service streams.

The browser connects to the backend only.  The backend validates the access
token, removes it from the upstream query string, and relays the AI frames to
the browser.  This keeps the AI service private and prevents its unauthenticated
streams from being exposed directly to the frontend.
"""

import asyncio
import json
import logging
from urllib.parse import parse_qsl, urlencode

import websockets
from fastapi import APIRouter, WebSocket
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_token
from app.database.connection import SessionLocal
from app.models.entities import Camera, RoleName, User


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
PEOPLE_ROLES = ALERT_ROLES
EMPLOYEE_ACTIVITY_ROLES = ALERT_ROLES


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


def _wanted_camera_scope(websocket: WebSocket) -> tuple[bool, set[str] | None]:
    """Return (valid, camera names) for a wanted stream.

    ``None`` means an ADMIN may see every camera. Other authorized users get
    only camera names belonging to their agency. The raw AI service is global,
    so filtering must happen at this backend boundary before a frame reaches
    the browser.
    """
    token = websocket.query_params.get("token")
    if not token:
        return False, set()
    try:
        payload = decode_token(token)
    except Exception:
        return False, set()

    db = SessionLocal()
    try:
        user = db.scalar(
            select(User).where(
                User.id == payload.get("sub"),
                User.is_active.is_(True),
            )
        )
        if user is None or user.role.name not in ALERT_ROLES:
            return False, set()
        if user.role.name == RoleName.ADMIN:
            return True, None
        if user.agency_id is None:
            return True, set()
        return True, set(
            db.scalars(select(Camera.name).where(Camera.agency_id == user.agency_id)).all()
        )
    finally:
        db.close()


def _filter_wanted_frame(raw_message: str, camera_scope: set[str] | None) -> str | None:
    """Remove cameras outside the user's agency from a wanted frame."""
    if camera_scope is None:
        return raw_message
    try:
        frame = json.loads(raw_message)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(frame, dict):
        return None
    if frame.get("type") == "snapshot" and isinstance(frame.get("cameras"), dict):
        frame["cameras"] = {
            name: detections
            for name, detections in frame["cameras"].items()
            if name in camera_scope
        }
        return json.dumps(frame)
    if frame.get("type") == "update" and frame.get("camera") not in camera_scope:
        return None
    return json.dumps(frame)


async def _proxy(
    websocket: WebSocket,
    upstream_path: str,
    allowed_roles: frozenset[str],
    *,
    agency_scope: bool = False,
) -> None:
    """Relay one AI stream until either side disconnects."""
    await websocket.accept()
    if not _is_authorized(websocket, allowed_roles):
        await _close(websocket, 1008)
        return

    camera_scope: set[str] | None = None
    if agency_scope:
        valid_scope, camera_scope = _wanted_camera_scope(websocket)
        if not valid_scope:
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
                        if not agency_scope:
                            await websocket.send_bytes(message)
                            continue
                        try:
                            message = message.decode("utf-8")
                        except UnicodeDecodeError:
                            continue
                        message = _filter_wanted_frame(message, camera_scope)
                        if message is not None:
                            await websocket.send_text(message)
                    else:
                        if agency_scope:
                            message = _filter_wanted_frame(message, camera_scope)
                            if message is None:
                                continue
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
    await _proxy(
        websocket,
        "/wanted/alerts/stream",
        ALERT_ROLES,
        agency_scope=True,
    )


@router.websocket("/ws/occupancy")
async def occupancy_websocket(websocket: WebSocket) -> None:
    await _proxy(websocket, "/zoning/occupancy/stream", OCCUPANCY_ROLES)


@router.websocket("/ws/people/tracks")
async def people_tracks_websocket(websocket: WebSocket) -> None:
    """Proxy live world tracks without exposing the AI service directly."""
    await _proxy(websocket, "/people/tracks/stream", PEOPLE_ROLES)


@router.websocket("/ws/employee-activity")
async def employee_activity_websocket(websocket: WebSocket) -> None:
    """Proxy workstation presence updates through the authenticated backend."""
    await _proxy(websocket, "/employee_activity/status/stream", EMPLOYEE_ACTIVITY_ROLES)
