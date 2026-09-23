import json

import httpx
import pytest

from app.integrations.ai_client import AIClient, AIClientError, AIServiceUnavailable


def test_ai_client_camera_operations_and_url_encoding() -> None:
    calls: list[tuple[str, str, object | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = None
        if request.content:
            payload = json.loads(request.content)
        calls.append((request.method, request.url.raw_path.decode(), payload))
        return httpx.Response(200, json={"ok": True})

    client = AIClient(
        "http://ai.test",
        transport=httpx.MockTransport(handler),
    )

    assert client.root() == {"ok": True}
    assert client.get_config() == {"ok": True}
    assert client.list_cameras() == {"ok": True}
    client.create_camera(
        "camera-entrance",
        url="rtsp://camera/stream",
        name="Entrance",
        features=["weapon", "fire"],
    )
    client.delete_camera("camera/entrance")
    client.update_camera_features("camera-entrance", ["people"])
    client.update_camera_quality("camera-entrance", 0.5)

    assert calls[3] == (
        "POST",
        "/cameras",
        {
            "id": "camera-entrance",
            "url": "rtsp://camera/stream",
            "name": "Entrance",
            "features": ["weapon", "fire"],
        },
    )
    assert calls[4][0:2] == ("DELETE", "/cameras/camera%2Fentrance")
    assert calls[5][0:2] == ("PUT", "/cameras/camera-entrance/features")
    assert calls[6][0:2] == ("PUT", "/cameras/camera-entrance/quality")


@pytest.mark.parametrize(
    ("upstream_status", "backend_status"),
    [(400, 400), (404, 404), (422, 422), (500, 502)],
)
def test_ai_client_maps_upstream_http_errors(
    upstream_status: int,
    backend_status: int,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(upstream_status, json={"detail": "Erreur AI"})

    client = AIClient("http://ai.test", transport=httpx.MockTransport(handler))

    with pytest.raises(AIClientError) as raised:
        client.list_cameras()

    assert raised.value.status_code == backend_status
    assert raised.value.upstream_status == upstream_status


def test_ai_client_returns_503_when_ai_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("AI offline", request=request)

    client = AIClient("http://ai.test", transport=httpx.MockTransport(handler))

    with pytest.raises(AIServiceUnavailable) as raised:
        client.get_config()

    assert raised.value.status_code == 503
    assert raised.value.detail == "Service AI indisponible"


def test_ai_client_builds_websocket_url() -> None:
    client = AIClient("http://127.0.0.1:8001")

    assert client.websocket_url("/weapon/alerts/stream") == (
        "ws://127.0.0.1:8001/weapon/alerts/stream"
    )


def test_ai_client_returns_binary_content_and_media_type() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"frame-bytes",
            headers={"content-type": "image/jpeg"},
        )

    client = AIClient("http://ai.test", transport=httpx.MockTransport(handler))

    content, media_type = client.request_bytes("GET", "/frame")

    assert content == b"frame-bytes"
    assert media_type == "image/jpeg"
