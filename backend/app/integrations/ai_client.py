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
        data: Mapping[str, Any] | None = None,
        files: Mapping[str, Any] | None = None,
        request_timeout: float | httpx.Timeout | None = None,
    ) -> httpx.Response:
        """Send one request and apply the common AI error policy."""
        url = self._url(path)
        try:
            with httpx.Client(
                timeout=request_timeout if request_timeout is not None else self.timeout,
                transport=self.transport,
            ) as client:
                response = client.request(
                    method,
                    url,
                    params=params,
                    json=payload,
                    data=data,
                    files=files,
                )
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
        request_timeout: float | httpx.Timeout | None = None,
    ) -> Any:
        """Send one JSON request and return its decoded JSON body.

        Upstream 400/404/422 responses preserve their status for the backend
        route. An upstream 5xx becomes 502, while timeout and connection
        failures become 503 Service Unavailable.
        """
        response = self._send(
            method,
            path,
            params=params,
            payload=payload,
            request_timeout=request_timeout,
        )

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

    def request_multipart_json(
        self,
        method: str,
        path: str,
        *,
        data: Mapping[str, Any],
        files: Mapping[str, Any],
        request_timeout: float | httpx.Timeout | None = None,
    ) -> Any:
        """Send multipart form data and decode the JSON response."""
        response = self._send(
            method,
            path,
            data=data,
            files=files,
            request_timeout=request_timeout,
        )
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

    def get(self, path: str, *, params: Mapping[str, Any] | None = None) -> Any:
        return self.request_json("GET", path, params=params)

    def post(self, path: str, *, payload: Any = None) -> Any:
        return self.request_json("POST", path, payload=payload)

    def post_with_timeout(
        self,
        path: str,
        *,
        payload: Any = None,
        request_timeout: float | httpx.Timeout,
    ) -> Any:
        return self.request_json(
            "POST",
            path,
            payload=payload,
            request_timeout=request_timeout,
        )

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

    def get_people_sources(self) -> Any:
        """Return the cameras currently assigned to person tracking."""
        return self.get("/people/sources")

    def set_people_sources(self, sources: Mapping[str, str]) -> Any:
        """Register camera streams for the AI person-tracking feature."""
        return self.post("/people/sources", payload={"sources": dict(sources)})

    def delete_people_source(self, camera_id: str) -> Any:
        """Remove one camera from person tracking without deleting the camera."""
        return self.delete(f"/people/sources/{quote(camera_id, safe='')}")

    def get_people_status(self) -> Any:
        """Return the person-tracking state machine and active-track count."""
        return self.get("/people/status")

    def list_zones(self) -> Any:
        """Return the zones configured in the AI zoning module."""
        return self.get("/zoning/zones")

    def create_zone(self, payload: Mapping[str, Any]) -> Any:
        """Create or replace one pixel/world occupancy zone."""
        return self.post("/zoning/zones", payload=dict(payload))

    def delete_zone(self, zone_name: str) -> Any:
        """Delete one occupancy zone by its stable name."""
        return self.delete(f"/zoning/zones/{quote(zone_name, safe='')}")

    def list_workstations(self) -> Any:
        """Return the AI employee-activity workstation states."""
        return self.get("/employee_activity/workstations")

    def create_workstation(self, payload: Mapping[str, Any]) -> Any:
        """Bind one AI workstation name to an existing zoning zone."""
        return self.post("/employee_activity/workstations", payload=dict(payload))

    def delete_workstation(self, name: str) -> Any:
        """Delete one AI employee-activity workstation."""
        return self.delete(f"/employee_activity/workstations/{quote(name, safe='')}")

    def enroll_face(
        self,
        stable_name: str,
        *,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> Any:
        """Enroll one employee photo without persisting the image in backend."""
        return self.request_multipart_json(
            "POST",
            "/face/enroll",
            data={"name": stable_name},
            files={"image": (filename, content, content_type)},
            request_timeout=30,
        )

    def list_faces(self) -> Any:
        """Return the AI face gallery; callers must strip embeddings before exposure."""
        return self.get("/face/faces")

    def delete_face(self, stable_name: str) -> Any:
        return self.delete(f"/face/faces/{quote(stable_name, safe='')}")

    def scan_face(self, *, source: str, timeout_seconds: float) -> Any:
        return self.post_with_timeout(
            "/face/scan",
            payload={"source": source, "timeout_seconds": timeout_seconds},
            request_timeout=timeout_seconds + 25,
        )

    def capture_face(self, *, source: str, timeout_seconds: float) -> Any:
        return self.post_with_timeout(
            "/face/capture",
            payload={"source": source, "timeout_seconds": timeout_seconds},
            request_timeout=timeout_seconds + 25,
        )

    def add_wanted_watchlist_entry(
        self,
        name: str,
        *,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> Any:
        """Add one image to the AI wanted gallery without storing it locally."""
        return self.request_multipart_json(
            "POST",
            "/wanted/watchlist",
            data={"name": name},
            files={"image": (filename, content, content_type)},
            request_timeout=30,
        )

    def list_wanted_watchlist(self) -> Any:
        """List wanted names and counts; embeddings are never requested."""
        return self.get("/wanted/watchlist", params={"include_embeddings": "false"})

    def delete_wanted_watchlist_entry(self, name: str) -> Any:
        return self.delete(f"/wanted/watchlist/{quote(name, safe='')}")

    def get_wanted_threshold(self) -> Any:
        return self.get("/wanted/threshold")

    def update_wanted_threshold(self, payload: Mapping[str, Any]) -> Any:
        return self.put("/wanted/threshold", payload=dict(payload))

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
