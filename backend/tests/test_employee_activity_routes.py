from app.api.employee_activity import router
from app.websocket.ai_proxy import router as websocket_router


def test_employee_activity_routes_are_exposed() -> None:
    paths = {route.path for route in router.routes}

    assert "/api/agencies/{agency_id}/workstations" in paths
    assert "/api/agencies/{agency_id}/workstations/{name}" in paths


def test_employee_activity_websocket_is_exposed() -> None:
    paths = {route.path for route in websocket_router.routes}

    assert "/ws/employee-activity" in paths
