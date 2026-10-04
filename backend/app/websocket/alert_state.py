"""In-process delivery of committed business-alert state events."""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.websocket.ai_proxy import SocketScope

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AlertStateSubscription:
    feature: str
    scope: SocketScope
    queue: asyncio.Queue[dict[str, Any]]
    loop: asyncio.AbstractEventLoop


class AlertStateConnectionManager:
    """Routes committed alert state events to authorized AI alert sockets."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._subscriptions: dict[int, AlertStateSubscription] = {}

    def subscribe(
        self,
        feature: str,
        scope: SocketScope,
    ) -> asyncio.Queue[dict[str, Any]]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        subscription = AlertStateSubscription(feature, scope, queue, loop)
        with self._lock:
            self._subscriptions[id(queue)] = subscription
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        with self._lock:
            self._subscriptions.pop(id(queue), None)

    def broadcast_from_thread(self, payload: dict[str, Any]) -> None:
        """Publish from an AI consumer thread without blocking its DB loop."""
        with self._lock:
            subscriptions = list(self._subscriptions.values())

        for subscription in subscriptions:
            if not self._is_visible(subscription, payload):
                continue
            if subscription.loop.is_closed():
                self.unsubscribe(subscription.queue)
                continue
            subscription.loop.call_soon_threadsafe(
                self._enqueue,
                subscription.queue,
                payload,
            )

    @staticmethod
    def _is_visible(
        subscription: AlertStateSubscription,
        payload: dict[str, Any],
    ) -> bool:
        if payload.get("alert_type") != subscription.feature:
            return False

        scope = subscription.scope
        if scope.agency_id is None:
            return True
        if payload.get("agency_id") != scope.agency_id:
            return False
        if scope.cameras is None:
            return True
        return payload.get("camera_name") in scope.cameras

    @staticmethod
    def _enqueue(
        queue: asyncio.Queue[dict[str, Any]],
        payload: dict[str, Any],
    ) -> None:
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            logger.warning("Alert state queue pleine; ancien evenement supprime")
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning("Impossible de publier l etat d alerte au frontend")


alert_state_manager = AlertStateConnectionManager()
