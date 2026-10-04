from app.ai_alerts.consumer import AI_ALERT_FEATURES, AIAlertConsumer
from app.integrations.ai_client import AIClientError
from app.services.ai_source_sync import AISourceSyncService
from app.websocket.ai_proxy import _filter_wanted_frame


class FakeAIClient:
    def __init__(self):
        self.calls = []

    def post(self, path, *, payload=None):
        self.calls.append(("POST", path, payload))
        return {"sources_known": sorted(payload["sources"])}

    def delete(self, path):
        self.calls.append(("DELETE", path, None))
        return {"deleted": True}


def test_source_sync_is_shared_by_all_alert_features():
    client = FakeAIClient()
    service = AISourceSyncService(client)
    sources = {"camera-entrance": "rtsp://entrance", "camera-counter": "rtsp://counter"}

    assert service.sync("weapon", sources) is True
    assert service.sync("fire", sources) is True
    assert service.sync("emotion", sources) is True
    assert [call[1] for call in client.calls] == [
        "/weapon/sources",
        "/fire/sources",
        "/emotion/sources",
    ]

    # An unchanged source map is not posted again for the same feature.
    assert service.sync("fire", sources) is True
    assert len(client.calls) == 3

    assert service.sync("fire", {"camera-entrance": "rtsp://entrance"}) is True
    assert client.calls[-2:] == [
        ("POST", "/fire/sources", {"sources": {"camera-entrance": "rtsp://entrance"}}),
        ("DELETE", "/fire/sources/camera-counter", None),
    ]


def test_already_absent_source_is_treated_as_synchronized():
    class MissingSourceClient(FakeAIClient):
        def delete(self, path):
            self.calls.append(("DELETE", path, None))
            raise AIClientError(
                "Camera inexistante",
                status_code=404,
                upstream_status=404,
                path=path,
            )

    client = MissingSourceClient()
    service = AISourceSyncService(client)

    assert service.sync(
        "weapon",
        {"camera-entrance": "rtsp://entrance"},
    ) is True
    assert service.sync("weapon", {}) is True
    assert client.calls == [
        ("POST", "/weapon/sources", {"sources": {"camera-entrance": "rtsp://entrance"}}),
        ("POST", "/weapon/sources", {"sources": {}}),
        ("DELETE", "/weapon/sources/camera-entrance", None),
    ]

    # The successful reconciliation updates the local registry, so the same
    # deletion is not retried on the next normal cycle.
    assert service.sync("weapon", {}) is True
    assert len(client.calls) == 3


def test_other_source_delete_errors_still_fail_synchronization():
    class BrokenDeleteClient(FakeAIClient):
        def delete(self, path):
            raise AIClientError(
                "Service AI indisponible",
                status_code=503,
                upstream_status=503,
                path=path,
            )

    client = BrokenDeleteClient()
    service = AISourceSyncService(client)
    assert service.sync("fire", {"camera-entrance": "rtsp://entrance"}) is True
    assert service.sync("fire", {}) is False

    # The previous registry is retained after a real failure so a later cycle
    # can retry the incomplete reconciliation.
    assert service.sync("fire", {}) is False


def test_alert_consumer_normalises_and_filters_detections_by_feature():
    consumer = AIAlertConsumer(AI_ALERT_FEATURES["fire"])
    detections = consumer._normalise_detections(
        [
            {"class": "fire", "confidence": "0.88", "bbox": [1, 2, 3, 4]},
            {"class": "invalid", "confidence": "not-a-number"},
        ]
    )

    assert detections == [
        {"class": "fire", "confidence": 0.88, "bbox": [1, 2, 3, 4]}
    ]


def test_weapon_consumer_keeps_only_detections_above_business_threshold():
    consumer = AIAlertConsumer(AI_ALERT_FEATURES["weapon"])
    detections = consumer._normalise_detections(
        [
            {"class": "knife", "confidence": 0.59},
            {"class": "pistol", "confidence": 0.91},
        ]
    )

    assert detections == [{"class": "pistol", "confidence": 0.91}]


def test_wanted_consumer_does_not_persist_biometric_snapshot():
    consumer = AIAlertConsumer(AI_ALERT_FEATURES["wanted"])
    detections = consumer._normalise_detections(
        [
            {
                "class": "PERSON-001",
                "confidence": 0.61,
                "bbox": [1, 2, 3, 4],
                "snapshot": "BASE64_JPEG",
                "det_score": 0.92,
                "face_px": 80,
            }
        ]
    )

    assert detections == [
        {"class": "PERSON-001", "confidence": 0.61, "bbox": [1, 2, 3, 4]}
    ]


def test_wanted_websocket_frame_is_scoped_to_allowed_cameras():
    snapshot = _filter_wanted_frame(
        '{"type":"snapshot","cameras":{"camera-entrance":[],"camera-counter":[{"class":"P1"}]}}',
        {"camera-entrance"},
    )
    assert snapshot is not None
    assert '"camera-entrance"' in snapshot
    assert '"camera-counter"' not in snapshot

    assert (
        _filter_wanted_frame(
            '{"type":"update","camera":"camera-counter","detections":[]}',
            {"camera-entrance"},
        )
        is None
    )
