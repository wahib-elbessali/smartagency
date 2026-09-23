from app.api.ai_people import router
from app.websocket.ai_proxy import router as websocket_router


def test_people_status_route_is_exposed_under_the_ai_agency_gateway() -> None:
    paths = {route.path for route in router.routes}

    assert "/agencies/{agency_id}/ai/people/status" in paths


def test_people_tracks_websocket_is_exposed() -> None:
    paths = {route.path for route in websocket_router.routes}

    assert "/ws/people/tracks" in paths
