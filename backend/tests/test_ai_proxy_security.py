from types import SimpleNamespace

import app.websocket.ai_proxy as ai_proxy
from app.core.config import settings


def _websocket_with_query(query: str) -> SimpleNamespace:
    return SimpleNamespace(scope={"query_string": query.encode("utf-8")})


def test_upstream_url_forwards_only_explicitly_allowed_parameters() -> None:
    websocket = _websocket_with_query(
        "token=secret&agency_id=other-agency&threshold=0.7&unknown=value"
    )

    url = ai_proxy._upstream_url(
        websocket,
        "/zoning/occupancy/stream",
        allowed_query_params=frozenset({"threshold"}),
    )

    assert url == "ws://127.0.0.1:8001/zoning/occupancy/stream?threshold=0.7"
    assert "secret" not in url
    assert "other-agency" not in url


def test_camera_filter_removes_frames_from_other_agencies() -> None:
    snapshot = ai_proxy._filter_camera_frame(
        '{"type":"snapshot","cameras":{"camera-entrance":[],"camera-counter":[{"class":"fire"}]}}',
        {"camera-entrance"},
    )
    assert snapshot is not None
    assert '"camera-entrance"' in snapshot
    assert '"camera-counter"' not in snapshot

    assert (
        ai_proxy._filter_camera_frame(
            '{"type":"update","camera":"camera-counter","detections":[]}',
            {"camera-entrance"},
        )
        is None
    )


def test_zone_and_workstation_filters_remove_foreign_resources() -> None:
    occupancy = ai_proxy._filter_occupancy_frame(
        '{"type":"snapshot","zones":{"hall":{"count":2},"other":{"count":9}}}',
        {"hall"},
    )
    assert occupancy is not None
    assert '"hall"' in occupancy
    assert '"other"' not in occupancy

    workstation = ai_proxy._filter_workstation_frame(
        '{"type":"snapshot","workstations":[{"name":"guichet-1"},{"name":"director-office"}]}',
        {"guichet-1"},
    )
    assert workstation is not None
    assert "guichet-1" in workstation
    assert "director-office" not in workstation


def test_people_filter_keeps_only_allowed_camera_boxes() -> None:
    frame = ai_proxy._filter_people_frame(
        '{"type":"tracks","tracks":[{"id":"track-1"}],"boxes":{"camera-entrance":[],"camera-counter":[]}}',
        {"camera-entrance"},
    )

    assert frame is not None
    assert '"camera-entrance"' in frame
    assert '"camera-counter"' not in frame


def test_websocket_connection_limits_are_global_and_per_user(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_ws_max_connections", 2)
    monkeypatch.setattr(settings, "ai_ws_max_connections_per_user", 1)

    assert ai_proxy._reserve_connection("user-1") is True
    assert ai_proxy._reserve_connection("user-1") is False
    assert ai_proxy._reserve_connection("user-2") is True
    assert ai_proxy._reserve_connection("user-3") is False

    ai_proxy._release_connection("user-1")
    ai_proxy._release_connection("user-2")
