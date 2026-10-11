"""Deployable surface over engine.py, mounted at /weapon by the unified app in
main.py. Continuous, always-on weapon detection across whatever cameras are
registered -- no zones/floor-position concept (unlike features/zoning), no
per-event trigger (unlike face_recognition's /scan): this is meant to always be
watching every registered camera and alert the instant a weapon-class appears in
ANY of them, using features/common/live_alert_service.py (shared with fire, emotion and
wanted detection).

- POST      /weapon/sources         -- {"sources": {cam: url_or_path, ...}} merges
                                        into the camera registry (accumulates
                                        across calls, same convention as zoning's
                                        POST /zones `sources` field). Once >=1
                                        source exists, detection runs continuously
                                        in the background.
- GET       /weapon/sources          -- current camera registry.
- DELETE    /weapon/sources/{camera} -- stop watching one camera.
- GET       /weapon/threshold        -- current runtime detector confidence.
- PUT       /weapon/threshold        -- {"conf": 0 < x <= 1} changes it at
                                        runtime (next detection call, no
                                        restart). Not persisted: the backend
                                        owns the value and re-applies it after
                                        every reconnection.
- WebSocket /weapon/alerts/stream    -- live per-camera detections, pushed only
                                        when the SET OF DETECTED CLASSES for a
                                        camera changes (see
                                        features/common/live_alert_service.py for why --
                                        confidence-score jitter alone must not
                                        trigger a push).

Frame preview is not duplicated here: the unified app serves one GET /frame and
GET /video_meta for every feature, since they were six byte-identical copies.

Tunables live in features/config.json under "weapon": conf (0.60), imgsz
(640), update_interval (seconds between detection cycles, 2.0). `conf` there is
only the startup default; the backend's business threshold is pushed through
PUT /weapon/threshold so the detector and the alert filter use one value.
"""
import threading
from contextlib import asynccontextmanager

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel, Field

from ..common.live_alert_service import LiveAlertService
from ..config import CONFIG
from .engine import detect_weapons

_CFG = CONFIG["weapon"]
CONF, IMGSZ, UPDATE_INTERVAL = _CFG["conf"], _CFG["imgsz"], _CFG["update_interval"]
STARTUP_CONF = CONF
# Guards the read-modify-write in PUT /threshold so `previous` is exact. The
# detection lambda below reads the module-global CONF at CALL time, so a new
# value takes effect on the next detection without touching LiveAlertService.
_conf_lock = threading.Lock()

service = LiveAlertService(feature_key='weapon', 
    detect_fn=lambda frame: detect_weapons(frame, conf=CONF, imgsz=IMGSZ),
    update_interval=UPDATE_INTERVAL,
)

router = APIRouter(prefix="/weapon", tags=["weapon detection"])


@asynccontextmanager
async def lifespan():
    """Entered by features/main.py's composed lifespan -- takes no `app` argument
    because it is not attached to a FastAPI instance directly."""
    await service.start()
    yield
    await service.stop()


class SourcesRequest(BaseModel):
    sources: dict[str, str]


@router.post("/sources")
def post_sources(req: SourcesRequest):
    service.set_sources(req.sources)
    return {"sources_known": sorted(service.sources())}


@router.get("/sources")
def get_sources():
    return service.sources()


@router.delete("/sources/{camera}")
def delete_source(camera: str):
    if camera not in service.sources():
        raise HTTPException(404, f"no such camera: {camera!r}")
    service.remove_source(camera)
    return {"camera": camera, "deleted": True}


class ThresholdRequest(BaseModel):
    conf: float = Field(gt=0, le=1)


@router.get("/threshold")
def get_threshold():
    return {"conf": CONF, "startup_default": STARTUP_CONF,
            "applies_within_seconds": UPDATE_INTERVAL}


@router.put("/threshold")
def put_threshold(req: ThresholdRequest):
    """Takes effect on the next detection call, with no restart. Deliberately
    NOT persisted (same convention as PUT /wanted/threshold): config.json stays
    the startup default and the backend re-applies its stored value."""
    global CONF
    with _conf_lock:
        previous = CONF
        CONF = float(req.conf)
        current = CONF
    return {"conf": current, "previous": previous, "startup_default": STARTUP_CONF,
            "applies_within_seconds": UPDATE_INTERVAL}


@router.websocket("/alerts/stream")
async def alerts_stream(ws: WebSocket):
    """Server push only: connect and immediately get a snapshot of every
    camera's currently-known detections, then one {"type":"update",
    "camera","detections"} message each time that camera's detected-class
    SET changes (appears/disappears/composition changes) -- not a fixed
    heartbeat, not every confidence-score jitter. The background detection
    loop keeps running whether or not anyone is connected."""
    await service.handle_connection(ws)
