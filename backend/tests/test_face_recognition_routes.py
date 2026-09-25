from app.api.face_recognition import ai_router, employee_router


def test_employee_face_routes_are_exposed() -> None:
    paths = {route.path for route in employee_router.routes}

    assert "/employees/{employee_id}/face" in paths
    assert "/employees/faces" in paths


def test_ai_face_routes_are_exposed() -> None:
    paths = {route.path for route in ai_router.routes}

    assert "/ai/face/scan" in paths
    assert "/ai/face/capture" in paths
