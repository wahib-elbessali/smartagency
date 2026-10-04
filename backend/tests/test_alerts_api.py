from types import SimpleNamespace

from app.api.alerts import router
from app.websocket.alert_state import AlertStateConnectionManager


def test_persisted_alerts_route_is_exposed() -> None:
    paths = {route.path for route in router.routes}
    assert "/agencies/{agency_id}/alerts" in paths


def test_alert_state_visibility_is_scoped_by_feature_agency_and_camera() -> None:
    manager = AlertStateConnectionManager()
    subscription = SimpleNamespace(
        feature="weapon",
        scope=SimpleNamespace(
            agency_id="agency-1",
            cameras={"camera-entrance"},
        ),
    )

    visible = {
        "alert_type": "weapon",
        "agency_id": "agency-1",
        "camera_name": "camera-entrance",
    }
    assert manager._is_visible(subscription, visible) is True
    assert manager._is_visible(
        subscription,
        {**visible, "agency_id": "agency-2"},
    ) is False
    assert manager._is_visible(
        subscription,
        {**visible, "camera_name": "camera-counter"},
    ) is False
    assert manager._is_visible(
        subscription,
        {**visible, "alert_type": "fire"},
    ) is False
