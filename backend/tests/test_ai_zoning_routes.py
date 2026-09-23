from app.api.ai_zoning import router


def test_zoning_routes_are_exposed_under_the_agency_ai_gateway() -> None:
    routes = {(route.path, tuple(route.methods or ())) for route in router.routes}

    assert (
        "/agencies/{agency_id}/ai/zones",
        ("GET",),
    ) in routes
    assert (
        "/agencies/{agency_id}/ai/zones",
        ("POST",),
    ) in routes
    assert any(
        path == "/agencies/{agency_id}/ai/zones/{zone_name}" and "DELETE" in methods
        for path, methods in routes
    )
