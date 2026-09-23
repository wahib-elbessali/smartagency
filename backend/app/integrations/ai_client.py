"""Internal HTTP client for the SmartAgency AI service.

The frontend must never call the AI process directly. Backend routes and
background workers use this client so that URL construction, timeouts, error
mapping and logging stay consistent in one place.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings


logger = logging.getLogger(__name__)


class AIClientError(RuntimeError):
    """Controlled error raised when an AI request cannot be completed."""

    def __init__(
        self,
        detail: str,
        *,
        status_code: int = 502,
        upstream_status: int | None = None,
        path: str | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.upstream_status = upstream_status
        self.path = path


class AIServiceUnavailable(AIClientError):
    """The AI service could not be reached before the request timed out."""

    def __init__(self, detail: str = "Service AI indisponible") -> None:
        super().__init__(detail, status_code=503)


def _response_detail(response: httpx.Response) -> str:
    """Extract a useful detail from an AI error response without leaking HTML."""
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, Mapping):
        detail = payload.get("detail") or payload.get("message") or payload.get("error")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()

    return f"Le service AI a retourne HTTP {response.status_code}"


class AIClient:
    """Synchronous client for the internal AI REST API.

    ``transport`` is injectable for deterministic tests. Production calls use
    a fresh short-lived HTTP client per request, which avoids sharing a client
    across FastAPI request threads and background workers.
    """

    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: float | httpx.Timeout | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        configured_url = base_url or settings.ai_service_url
        self.base_url = configured_url.rstrip("/")
        if not self.base_url:
            raise ValueError("AI_SERVICE_URL ne peut pas etre vide")
        self.timeout = timeout if timeout is not None else settings.ai_request_timeout_seconds
        self.transport = transport

    def _url(self, path: str) -> str:
        return f"{self.base_url}/{path.lstrip('/')}"

    def _send(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        payload: Any = None,
    ) -> httpx.Response:
        """Send one request and apply the common AI error policy."""
        url = self._url(path)
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.request(method, url, params=params, json=payload)
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
            logger.warning("Service AI indisponible pour %s %s: %s", method, path, exc)
            error = AIServiceUnavailable()
            error.path = path
            raise error from exc
        except httpx.RequestError as exc:
            logger.exception("Erreur reseau pendant l appel AI %s %s", method, path)
            error = AIServiceUnavailable("Erreur de communication avec le service AI")
            error.path = path
            raise error from exc

        if response.is_error:
            detail = _response_detail(response)
            if response.status_code in {400, 404, 422}:
                backend_status = response.status_code
            elif response.status_code >= 500:
                backend_status = 502
                detail = "Le service AI a rencontre une erreur interne"
            else:
                backend_status = 502

            logger.warning(
                "Erreur du service AI: %s %s -> %s (%s)",
                method,
                path,
                response.status_code,
                detail,
            )
            raise AIClientError(
                detail,
                status_code=backend_status,
                upstream_status=response.status_code,
                path=path,
            )

        return response

    def request_json(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        payload: Any = None,
    ) -> Any:
        """Send one JSON request and return its decoded JSON body.

        Upstream 400/404/422 responses preserve their status for the backend
        route. An upstream 5xx becomes 502, while timeout and connection
        failures become 503 Service Unavailable.
        """
        response = self._send(method, path, params=params, payload=payload)

        try:
            return response.json()
        except ValueError as exc:
            logger.error("Reponse JSON invalide du service AI pour %s %s", method, path)
            raise AIClientError(
                "Le service AI a retourne une reponse invalide",
                status_code=502,
                upstream_status=response.status_code,
                path=path,
            ) from exc

    def request_bytes(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
    ) -> tuple[bytes, str]:
        """Return a binary AI response and its media type."""
        response = self._send(method, path, params=params)
        return response.content, response.headers.get(
            "content-type", "application/octet-stream"
        )

    def get(self, path: str, *, params: Mapping[str, Any] | None = None) -> Any:
        return self.request_json("GET", path, params=params)

    def post(self, path: str, *, payload: Any = None) -> Any:
        return self.request_json("POST", path, payload=payload)

    def put(self, path: str, *, payload: Any = None) -> Any:
        return self.request_json("PUT", path, payload=payload)

    def delete(self, path: str) -> Any:
        return self.request_json("DELETE", path)

    def root(self) -> Any:
        return self.get("/")

    def get_config(self) -> Any:
        return self.get("/config")

    def list_cameras(self) -> Any:
        return self.get("/cameras")

    def create_camera(
        self,
        camera_id: str,
        *,
        url: str,
        name: str | None = None,
        quality: float | None = None,
        features: Sequence[str] | None = None,
    ) -> Any:
        payload: dict[str, Any] = {"id": camera_id, "url": url}
        if name is not None:
            payload["name"] = name
        if quality is not None:
            payload["quality"] = quality
        if features is not None:
            payload["features"] = list(features)
        return self.post("/cameras", payload=payload)

    def delete_camera(self, camera_id: str) -> Any:
        return self.delete(f"/cameras/{quote(camera_id, safe='')}")

    def update_camera_features(self, camera_id: str, features: Sequence[str]) -> Any:
        path = f"/cameras/{quote(camera_id, safe='')}/features"
        return self.put(path, payload={"features": list(features)})

    def update_camera_quality(self, camera_id: str, quality: float) -> Any:
        path = f"/cameras/{quote(camera_id, safe='')}/quality"
        return self.put(path, payload={"quality": quality})

    def websocket_url(self, path: str) -> str:
        """Build the AI WebSocket URL from the configured HTTP base URL."""
        if self.base_url.startswith("https://"):
            base = "wss://" + self.base_url[len("https://") :]
        elif self.base_url.startswith("http://"):
            base = "ws://" + self.base_url[len("http://") :]
        else:
            base = self.base_url
        return f"{base}/{path.lstrip('/')}"


ai_client = AIClient()
