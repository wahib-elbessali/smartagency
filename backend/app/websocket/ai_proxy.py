"""Authenticated and agency-scoped WebSocket proxies for AI streams."""

import asyncio
import json
import logging
import threading
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode

import websockets
from fastapi import APIRouter, WebSocket
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import decode_token
from app.database.connection import SessionLocal
from app.models.entities import Agency, Camera, RoleName, User, Workstation, Zone
from app.websocket.alert_state import alert_state_manager


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

_CONNECTION_LOCK = threading.Lock()
_ACTIVE_CONNECTIONS = 0
_ACTIVE_CONNECTIONS_BY_USER: dict[str, int] = {}


@dataclass(frozen=True)
class SocketScope:
    """Authorization and data-filtering context for one browser socket."""

    user_id: str
    role: str
    agency_id: str | None
    cameras: set[str] | None
    zones: set[str] | None
    workstations: set[str] | None


def _role_value(role: RoleName | str) -> str:
    return role.value if isinstance(role, RoleName) else str(role)


def _upstream_base_url() -> str:
    """Convert the configured AI HTTP URL to its WebSocket equivalent."""
    base = settings.ai_service_url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :]
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :]
    return base


def _upstream_url(
    websocket: WebSocket,
    path: str,
    *,
    allowed_query_params: frozenset[str] = frozenset(),
) -> str:
    """Build an upstream URL without forwarding the browser JWT.

    Only explicitly documented, non-authentication query parameters may cross
    the backend/AI boundary. In particular, token, agency_id and arbitrary
    client parameters are never forwarded.
    """
    raw_query = websocket.scope.get("query_string", b"")
    if isinstance(raw_query, bytes):
        raw_query = raw_query.decode("utf-8")
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(raw_query, keep_blank_values=True)
            if key in allowed_query_params
        ]
    )
    suffix = f"?{query}" if query else ""
    return f"{_upstream_base_url()}{path}{suffix}"


async def _close(
    websocket: WebSocket,
    code: int,
    reason: str | None = None,
) -> None:
    try:
        if reason is None:
            await websocket.close(code=code)
        else:
            await websocket.close(code=code, reason=reason)
    except Exception:
        # The peer may already have closed the connection.
        pass


def _resolve_socket_scope(
    websocket: WebSocket,
    allowed_roles: frozenset[str],
    stream_kind: str,
) -> SocketScope | None:
    """Validate the JWT against the active database user and build scopes.

    The AI process is global. Therefore a non-admin socket receives only
    resources belonging to its agency. The people stream is currently global
    and has no agency field in its frames; it is allowed for non-admin users
    only while the deployment contains one active agency.
    """
    token = websocket.query_params.get("token")
    if not token:
        logger.warning("AI WebSocket rejected: missing token")
        return None

    try:
        payload = decode_token(token)
    except Exception:
        logger.warning("AI WebSocket rejected: invalid or expired token")
        return None

    user_id = payload.get("sub")
    token_role = payload.get("role")
    if not user_id or not token_role:
        logger.warning("AI WebSocket rejected: incomplete token claims")
        return None

    db = SessionLocal()
    try:
        user = db.scalar(
            select(User).where(
                User.id == user_id,
                User.is_active.is_(True),
            )
        )
        if user is None or user.role is None:
            logger.warning("AI WebSocket rejected: inactive or unknown user %s", user_id)
            return None

        role = _role_value(user.role.name)
        # A token with a stale role must not retain access after an account
        # update. The database role is authoritative.
        if role != token_role or role not in allowed_roles:
            logger.warning("AI WebSocket rejected: role mismatch or insufficient role")
            return None

        if role == RoleName.ADMIN.value:
            return SocketScope(
                user_id=user.id,
                role=role,
                agency_id=None,
                cameras=None,
                zones=None,
                workstations=None,
            )

        if user.agency_id is None:
            logger.warning("AI WebSocket rejected: user %s has no agency", user.id)
            return None

        if stream_kind == "people":
            active_agencies = db.scalar(
                select(func.count(Agency.id)).where(Agency.is_active.is_(True))
            ) or 0
            if active_agencies > 1:
                # The current AI people payload contains global tracks but no
                # agency identifier. Sending it to a non-admin would be unsafe.
                logger.error(
                    "AI people stream rejected for user %s: global AI stream "
                    "cannot be safely scoped across %s agencies",
                    user.id,
                    active_agencies,
                )
                return None

        cameras: set[str] | None = None
        zones: set[str] | None = None
        workstations: set[str] | None = None

        if stream_kind in {"alerts", "people"}:
            cameras = set(
                db.scalars(
                    select(Camera.name).where(Camera.agency_id == user.agency_id)
                ).all()
            )
        elif stream_kind == "occupancy":
            zones = set(
                db.scalars(
                    select(Zone.name).where(Zone.agency_id == user.agency_id)
                ).all()
            )
        elif stream_kind == "employee_activity":
            workstations = set(
                db.scalars(
                    select(Workstation.name).where(
                        Workstation.agency_id == user.agency_id
                    )
                ).all()
            )

        return SocketScope(
            user_id=user.id,
            role=role,
            agency_id=user.agency_id,
            cameras=cameras,
            zones=zones,
            workstations=workstations,
        )
    finally:
        db.close()


def _reserve_connection(user_id: str) -> bool:
    """Reserve a global and per-user socket slot."""
    global _ACTIVE_CONNECTIONS
    with _CONNECTION_LOCK:
        current_user_connections = _ACTIVE_CONNECTIONS_BY_USER.get(user_id, 0)
        if _ACTIVE_CONNECTIONS >= settings.ai_ws_max_connections:
            return False
        if current_user_connections >= settings.ai_ws_max_connections_per_user:
            return False
        _ACTIVE_CONNECTIONS += 1
        _ACTIVE_CONNECTIONS_BY_USER[user_id] = current_user_connections + 1
        return True


def _release_connection(user_id: str) -> None:
    """Release a previously reserved socket slot."""
    global _ACTIVE_CONNECTIONS
    with _CONNECTION_LOCK:
        _ACTIVE_CONNECTIONS = max(0, _ACTIVE_CONNECTIONS - 1)
        current = _ACTIVE_CONNECTIONS_BY_USER.get(user_id, 0)
        if current <= 1:
            _ACTIVE_CONNECTIONS_BY_USER.pop(user_id, None)
        else:
            _ACTIVE_CONNECTIONS_BY_USER[user_id] = current - 1


def _filter_camera_frame(raw_message: str, camera_scope: set[str] | None) -> str | None:
    """Filter alert frames whose camera names are supplied by the AI service."""
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
    elif frame.get("type") == "update" and frame.get("camera") not in camera_scope:
        return None
    return json.dumps(frame)


def _filter_wanted_frame(raw_message: str, camera_scope: set[str] | None) -> str | None:
    """Backward-compatible alias used by the wanted-alert consumer tests."""
    return _filter_camera_frame(raw_message, camera_scope)


def _filter_occupancy_frame(raw_message: str, zone_scope: set[str] | None) -> str | None:
    """Filter occupancy snapshots and updates to the user's agency zones."""
    if zone_scope is None:
        return raw_message
    try:
        frame = json.loads(raw_message)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(frame, dict):
        return None

    if frame.get("type") == "snapshot" and isinstance(frame.get("zones"), dict):
        frame["zones"] = {
            name: value
            for name, value in frame["zones"].items()
            if name in zone_scope
        }
    elif frame.get("type") == "update" and frame.get("zone") not in zone_scope:
        return None
    return json.dumps(frame)


def _filter_people_frame(raw_message: str, camera_scope: set[str] | None) -> str | None:
    """Filter camera-specific boxes from the global people stream.

    The current AI contract does not attach an agency to each world track.
    Non-admin access is consequently permitted only in a single-agency
    deployment, as enforced by _resolve_socket_scope.
    """
    if camera_scope is None:
        return raw_message
    try:
        frame = json.loads(raw_message)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(frame, dict):
        return None

    if isinstance(frame.get("boxes"), dict):
        frame["boxes"] = {
            name: boxes
            for name, boxes in frame["boxes"].items()
            if name in camera_scope
        }
    if not camera_scope and isinstance(frame.get("tracks"), list):
        frame["tracks"] = []
    return json.dumps(frame)


def _filter_workstation_frame(
    raw_message: str,
    workstation_scope: set[str] | None,
) -> str | None:
    """Filter employee-activity snapshots and updates by workstation."""
    if workstation_scope is None:
        return raw_message
    try:
        frame = json.loads(raw_message)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(frame, dict):
        return None

    if frame.get("type") == "snapshot" and isinstance(
        frame.get("workstations"), list
    ):
        frame["workstations"] = [
            workstation
            for workstation in frame["workstations"]
            if isinstance(workstation, dict)
            and workstation.get("name") in workstation_scope
        ]
    elif frame.get("type") == "update":
        workstation_name = frame.get("name") or frame.get("workstation")
        if workstation_name not in workstation_scope:
            return None
    return json.dumps(frame)


def _filter_frame(
    raw_message: str,
    scope: SocketScope,
    stream_kind: str,
) -> str | None:
    if stream_kind == "alerts":
        return _filter_camera_frame(raw_message, scope.cameras)
    if stream_kind == "occupancy":
        return _filter_occupancy_frame(raw_message, scope.zones)
    if stream_kind == "people":
        return _filter_people_frame(raw_message, scope.cameras)
    if stream_kind == "employee_activity":
        return _filter_workstation_frame(raw_message, scope.workstations)
    return None


async def _proxy(
    websocket: WebSocket,
    upstream_path: str,
    allowed_roles: frozenset[str],
    *,
    stream_kind: str,
    upstream_query_params: frozenset[str] = frozenset(),
    alert_state_feature: str | None = None,
) -> None:
    """Relay one scoped AI stream until either side disconnects."""
    await websocket.accept()
    try:
        scope = _resolve_socket_scope(websocket, allowed_roles, stream_kind)
    except Exception:
        logger.exception("Unable to resolve AI WebSocket authorization scope")
        await _close(websocket, 1013, "Service backend indisponible")
        return
    if scope is None:
        await _close(websocket, 1008, "Acces WebSocket refuse")
        return

    if not _reserve_connection(scope.user_id):
        logger.warning("AI WebSocket limit reached for user %s", scope.user_id)
        await _close(websocket, 1013, "Trop de connexions WebSocket")
        return

    upstream_url = _upstream_url(
        websocket,
        upstream_path,
        allowed_query_params=upstream_query_params,
    )
    upstream_finished = False
    state_queue = (
        alert_state_manager.subscribe(alert_state_feature, scope)
        if alert_state_feature is not None
        else None
    )
    send_lock = asyncio.Lock()

    try:
        async with websockets.connect(
            upstream_url,
            ping_interval=20,
            ping_timeout=20,
        ) as upstream:

            async def relay_upstream() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        try:
                            message = message.decode("utf-8")
                        except UnicodeDecodeError:
                            continue
                    filtered = _filter_frame(message, scope, stream_kind)
                    if filtered is not None:
                        async with send_lock:
                            await websocket.send_text(filtered)

            async def relay_alert_state() -> None:
                if state_queue is None:
                    return
                while True:
                    payload = await state_queue.get()
                    async with send_lock:
                        await websocket.send_json(payload)

            async def drain_client() -> None:
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        return

            relay_task = asyncio.create_task(relay_upstream())
            client_task = asyncio.create_task(drain_client())
            state_task = (
                asyncio.create_task(relay_alert_state())
                if state_queue is not None
                else None
            )
            tasks = {relay_task, client_task}
            if state_task is not None:
                tasks.add(state_task)
            done, pending = await asyncio.wait(
                tasks,
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
            upstream_finished = relay_task in done or (
                state_task is not None and state_task in done
            )
    except websockets.exceptions.ConnectionClosed:
        upstream_finished = True
    except Exception:
        logger.exception("AI service WebSocket unavailable: %s", upstream_url)
        await _close(websocket, 1013, "Service AI indisponible")
        return
    finally:
        if state_queue is not None:
            alert_state_manager.unsubscribe(state_queue)
        _release_connection(scope.user_id)

    if upstream_finished:
        # The AI stream ended before the browser disconnected. Tell the
        # frontend to reconnect instead of reporting a normal close.
        await _close(websocket, 1013, "Service AI indisponible")


@router.websocket("/ws/alerts/weapon")
async def weapon_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/weapon/alerts/stream",
        ALERT_ROLES,
        stream_kind="alerts",
        alert_state_feature="weapon",
    )


@router.websocket("/ws/alerts/fire")
async def fire_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/fire/alerts/stream",
        ALERT_ROLES,
        stream_kind="alerts",
        alert_state_feature="fire",
    )


@router.websocket("/ws/alerts/emotion")
async def emotion_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/emotion/alerts/stream",
        ALERT_ROLES,
        stream_kind="alerts",
        alert_state_feature="emotion",
    )


@router.websocket("/ws/alerts/wanted")
async def wanted_alerts_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/wanted/alerts/stream",
        ALERT_ROLES,
        stream_kind="alerts",
        alert_state_feature="wanted",
    )


@router.websocket("/ws/occupancy")
async def occupancy_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/zoning/occupancy/stream",
        OCCUPANCY_ROLES,
        stream_kind="occupancy",
        # threshold is a documented AI tuning parameter. Authentication and
        # agency identity are deliberately never forwarded.
        upstream_query_params=frozenset({"threshold"}),
    )


@router.websocket("/ws/people/tracks")
async def people_tracks_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/people/tracks/stream",
        PEOPLE_ROLES,
        stream_kind="people",
    )


@router.websocket("/ws/employee-activity")
async def employee_activity_websocket(websocket: WebSocket) -> None:
    await _proxy(
        websocket,
        "/employee_activity/status/stream",
        EMPLOYEE_ACTIVITY_ROLES,
        stream_kind="employee_activity",
    )
