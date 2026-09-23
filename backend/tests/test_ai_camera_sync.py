from types import SimpleNamespace

from app.models.entities import DeviceStatus
from app.services.ai_camera_sync import AICameraSyncService, AI_CAMERA_FEATURES
from app.integrations.ai_client import AIServiceUnavailable


class FakeAIClient:
    def __init__(self) -> None:
        self.created: list[dict[str, object]] = []
        self.deleted: list[str] = []
        self.people_sources: list[dict[str, object]] = []

    def create_camera(self, camera_id: str, **payload: object) -> dict[str, object]:
        self.created.append({"id": camera_id, **payload})
        return {"id": camera_id}

    def delete_camera(self, camera_id: str) -> dict[str, object]:
        self.deleted.append(camera_id)
        return {"id": camera_id, "deleted": True}

    def get_people_sources(self) -> dict[str, object]:
        return {"sources_known": [entry["id"] for entry in self.people_sources]}

    def set_people_sources(self, sources: dict[str, str]) -> dict[str, object]:
        self.people_sources = [{"id": camera_id, "url": url} for camera_id, url in sources.items()]
        return {"sources_known": list(sources)}

    def delete_people_source(self, camera_id: str) -> dict[str, object]:
        self.people_sources = [entry for entry in self.people_sources if entry["id"] != camera_id]
        return {"camera": camera_id, "deleted": True}

    def get_people_status(self) -> dict[str, object]:
        return {"phase": "idle", "active_tracks": None}


def test_sync_camera_registers_all_features_and_marks_online() -> None:
    fake = FakeAIClient()
    service = AICameraSyncService(client=fake)
    camera = SimpleNamespace(
        name="camera-entrance",
        stream_url="rtsp://192.168.1.16:8554/stream",
        status=DeviceStatus.OFFLINE,
    )

    assert service.sync_camera(camera) is True
    assert camera.status == DeviceStatus.ONLINE
    assert fake.created == [
        {
            "id": "camera-entrance",
            "url": "rtsp://192.168.1.16:8554/stream",
            "name": "camera-entrance",
            "quality": 1.0,
            "features": AI_CAMERA_FEATURES,
        }
    ]
    assert fake.people_sources == [
        {"id": "camera-entrance", "url": "rtsp://192.168.1.16:8554/stream"}
    ]


def test_sync_camera_marks_offline_when_ai_is_unavailable() -> None:
    class OfflineAIClient(FakeAIClient):
        def create_camera(self, camera_id: str, **payload: object) -> dict[str, object]:
            raise AIServiceUnavailable()

    camera = SimpleNamespace(
        name="camera-counter",
        stream_url="rtsp://192.168.1.17:8554/stream",
        status=DeviceStatus.ONLINE,
    )

    service = AICameraSyncService(client=OfflineAIClient())

    assert service.sync_camera(camera) is False
    assert camera.status == DeviceStatus.OFFLINE


def test_sync_camera_deletes_previous_ai_name_when_camera_is_renamed() -> None:
    fake = FakeAIClient()
    service = AICameraSyncService(client=fake)
    camera = SimpleNamespace(
        name="camera-entrance-v2",
        stream_url="rtsp://192.168.1.16:8554/stream",
        status=DeviceStatus.OFFLINE,
    )

    assert service.sync_camera(camera, previous_name="camera-entrance") is True
    assert fake.deleted == ["camera-entrance"]
    assert camera.status == DeviceStatus.ONLINE
