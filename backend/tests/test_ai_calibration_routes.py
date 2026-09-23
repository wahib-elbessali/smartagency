from app.api.ai_calibration import router


def test_calibration_routes_are_exposed_under_the_backend_gateway() -> None:
    paths = {route.path for route in router.routes}

    assert "/agencies/{agency_id}/ai/calibration" in paths
    assert "/agencies/{agency_id}/ai/calibration/rect" in paths
    assert "/agencies/{agency_id}/ai/calibration/align" in paths
    assert "/agencies/{agency_id}/ai/calibration/cross-check" in paths
    assert "/agencies/{agency_id}/ai/calibration/gates" in paths
    assert "/agencies/{agency_id}/ai/frame" in paths
