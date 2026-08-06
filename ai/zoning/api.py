"""Deployable surface over zones.py. A real frontend owns the interactive
part (showing a camera image, letting someone click polygon corners --
reference_ui/zoning/zone_app.py is a reference implementation of that
interaction, not the deployed one); this API only ever receives a COMPLETE
polygon per call.

Mounted at /zoning by the unified app in features/main.py.

- GET       /zoning/zones    -- every current zone (mode/camera/polygon).
- POST      /zoning/zones     -- {"name", "camera", "polygon": [[px,py],...],
                                  "sources": {cam: url_or_path, ...}} (>=3
                                  polygon points). `camera` is the camera the
                                  polygon was DRAWN on and must be one of
                                  `sources`. The zone's MODE is inferred from
                                  how many cameras `sources` carries: one ->
                                  pixel zone (that camera's own detections, no
                                  calibration needed), two or more -> world
                                  zone (converted to floor metres via
                                  `camera`'s calibration, counted against
                                  multi-camera fused positions). See the route
                                  docstring. `sources` is also how this
                                  deployment learns where to pull each
                                  camera's LIVE feed from (calibration only
                                  gives pixel<->floor math, never a feed
                                  address) -- merged into the site-wide camera
                                  registry the background loop below reads
                                  from, keyed by camera id, so it accumulates
                                  across every zone that's ever been created,
                                  not just this one.
- DELETE    /zoning/zones/{name}      -- removes one zone entirely.
- WebSocket /zoning/occupancy/stream  -- live per-zone occupancy, pushed only when
                                  a zone's count actually CHANGES (not a
                                  fixed heartbeat). Optional `?threshold=N`
                                  query param: only bother this connection
                                  once a zone's count is >= N (still tells
                                  it when a zone drops back below, so its
                                  view never goes stale). See the docstring
                                  on that route.

The frontend gets its clickable camera image from the app-level GET /frame and
GET /video_meta, shared by every feature rather than duplicated here.

Detection runs CONTINUOUSLY in the background once at least one zone AND at
least one camera source exist -- there is no on-demand "give me occupancy
right now" endpoint anymore (an earlier version had a blocking POST
/occupancy; replaced entirely by the WebSocket, per the same "one way to do
a job" reasoning used everywhere else in this project -- a backend just
connects to the stream and gets pushed updates, or doesn't connect and the
detection loop runs regardless). Tunables live in features/config.json under
"zoning": weights, imgsz, conf, fuse_dist, min_cameras, update_interval (the
last default 2.0s -- responsive enough for a live queue display without pinning
the CPU continuously on the Pi 4 deployment target). Zones and calibration are
read from and written to features/data/, a fixed location -- see paths.py.
"""
import asyncio
import threading
from contextlib import asynccontextmanager

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..common.video_source import read_frame
from ..common.fusion import fuse_camera_boxes
from ..calibration.engine import load_calibration
from ..config import CONFIG
from ..paths import CALIBRATION, MODELS, ZONES
from .zones import (
    add_pixel_zone, add_world_zone, load_zones, occupancy, pixel_to_world_m, remove_zone,
    save_zones, zones_to_dict,
)

_CFG = CONFIG["zoning"]
IMGSZ, CONF = _CFG["imgsz"], _CFG["conf"]
FUSE_DIST = _CFG["fuse_dist"]                  # cm, world-mode zones only
MIN_CAMERAS = _CFG["min_cameras"]              # world-mode zones only
UPDATE_INTERVAL = _CFG["update_interval"]

# The person detector. Unlike weapon/fire detection this is a project-TRAINED
# model rather than a public checkpoint, so it comes from this project's own HF
# repo -- the same public repo weapon_detection uses, and the very checkpoint the
# multi-dataset fine-tune run uploaded (verified sha256-identical to the local
# models/yolo11m_multi.pt it was copied from). No token needed; the repo is
# public. Set config.json's zoning.weights to a local path to skip the download.
WEIGHTS = _CFG["weights"]                      # null -> download on first use
_HF_REPO = "wahib-elbessali/smartagency-detector"
_HF_FILE = "checkpoints/yolo11m_multi/best.pt"
_WEIGHTS_PATH = MODELS / "yolo11m_multi.pt"

_zones = load_zones(ZONES) if ZONES.exists() else {}
_zones_lock = threading.Lock()

_sources = {}            # {camera_id: url_or_path} -- the site-wide live-feed registry
_sources_lock = threading.Lock()

_last_counts = {}        # {zone_name: {"count", "points"}} -- last state PUSHED, for change detection
_ws_clients = {}         # {WebSocket: threshold} -- only ever touched from the event loop

_yolo_models = {}        # {weights_path: YOLO}, lazy-loaded, reused across calls
_yolo_lock = threading.Lock()


def _ensure_weights():
    """-> a local path to the person detector, downloading it once if needed.

    Same lazy-download pattern as weapon/fire detection, and it exists for the
    same reason: this package is meant to be copied into any project and run, so
    it cannot depend on a 40MB file happening to sit in a sibling directory.

    Fails LOUDLY rather than falling back to a stock ultralytics detector. A
    silent fallback would still produce boxes, so nothing would look broken --
    while quietly giving up the fine-tune's measured gain (Lab6p recall 8.4% ->
    95.7%). Wrong-but-plausible counts are worse than an error that names the
    problem."""
    if WEIGHTS:
        return WEIGHTS                                  # explicit override, local file
    if not _WEIGHTS_PATH.exists():
        import shutil
        from huggingface_hub import hf_hub_download
        _WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            downloaded = hf_hub_download(_HF_REPO, _HF_FILE)
        except Exception as e:
            raise RuntimeError(
                f"could not fetch the person detector ({_HF_FILE} from {_HF_REPO}): {e}. "
                f"Zone occupancy cannot run without it. Either upload it to that repo, or "
                f"set config.json's zoning.weights to a local copy of yolo11m_multi.pt.") from e
        shutil.copy(downloaded, _WEIGHTS_PATH)
    return str(_WEIGHTS_PATH)


def _get_yolo():
    with _yolo_lock:
        weights = _ensure_weights()
        if weights not in _yolo_models:
            from ultralytics import YOLO
            _yolo_models[weights] = YOLO(weights)
        return _yolo_models[weights]


def _run_detection_cycle(sources, zones_snapshot):
    """Synchronous, CPU-bound -- ONE live frame per camera in `sources`, run
    through detection + (if needed) multi-camera fusion, -> {zone_name:
    [(x,y), ...]}. Run inside asyncio.to_thread() by the background loop so
    it never blocks the event loop (and therefore never blocks the
    WebSocket's own traffic) while YOLO is working."""
    imgs = {}
    for cam, source in sources.items():
        frame = read_frame(source)
        if frame is not None:
            imgs[cam] = frame
    if not imgs:
        return {}

    model = _get_yolo()
    results = model.predict(list(imgs.values()), imgsz=IMGSZ, conf=CONF, classes=[0], verbose=False)
    raw_boxes_by_cam = {}
    for cam, r in zip(imgs, results):
        b = r.boxes
        raw_boxes_by_cam[cam] = ([tuple(map(float, x)) for x in b.xyxy.cpu().numpy()]
                                  if b is not None and len(b) else [])

    fused_positions = []
    if any(z["mode"] == "world" for z in zones_snapshot.values()):
        cal = load_calibration(CALIBRATION)
        cam_boxes = [(c, b) for c, boxes in raw_boxes_by_cam.items() for b in boxes]
        fused = fuse_camera_boxes(cam_boxes, cal, fuse_dist=FUSE_DIST, region=None,
                                  min_cameras=MIN_CAMERAS)
        fused_positions = [(d[0], d[1]) for d in fused]

    return occupancy(fused_positions, raw_boxes_by_cam, zones_snapshot)


async def _broadcast_update(zone_name, new_state, old_count):
    """Sends to each connected client UNLESS both the old and new count are
    below that client's own threshold (a connection with ?threshold=3 never
    hears about a zone bouncing between 0 and 2). A transition INTO the
    threshold (old < N <= new) or OUT of it (new < N <= old) is always sent
    -- otherwise a client's last-known state for a zone would go stale the
    moment it drops back below their threshold and just never update again."""
    dead = []
    for ws, threshold in list(_ws_clients.items()):
        if new_state["count"] < threshold and old_count < threshold:
            continue
        try:
            await ws.send_json({"type": "update", "zone": zone_name, **new_state})
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.pop(ws, None)


async def _background_loop():
    while True:
        with _zones_lock:
            zones_snapshot = dict(_zones)
        with _sources_lock:
            sources_snapshot = dict(_sources)
        if zones_snapshot and sources_snapshot:
            try:
                occ = await asyncio.to_thread(_run_detection_cycle, sources_snapshot, zones_snapshot)
                for name, pts in occ.items():
                    new_state = {"count": len(pts), "points": [[round(x, 1), round(y, 1)] for x, y in pts]}
                    old_count = _last_counts.get(name, {}).get("count", 0)
                    if old_count != new_state["count"]:
                        _last_counts[name] = new_state
                        await _broadcast_update(name, new_state, old_count)
            except Exception as e:
                print(f"[zoning.api] background detection cycle failed: {e}")
        await asyncio.sleep(UPDATE_INTERVAL)


@asynccontextmanager
async def lifespan():
    task = asyncio.create_task(_background_loop())
    yield
    task.cancel()


router = APIRouter(prefix="/zoning", tags=["zoning"])


@router.get("/zones")
def get_zones():
    with _zones_lock:
        return zones_to_dict(_zones)


class ZoneRequest(BaseModel):
    name: str
    camera: str                          # the camera the polygon was DRAWN on
    polygon: list[list[float]]           # [[px, py], ...], >= 3 points, in `camera`'s pixel space
    sources: dict[str, str] = {}         # {camera_id: url_or_path} -- merged into the site registry


def _to_world(name, camera, polygon_px):
    """Converts a just-drawn pixel polygon into a world-metre one via `camera`'s
    calibration. -> (polygon_m, converted_from). Raises HTTPException(422) rather
    than producing a plausible-but-wrong zone.

    Refusing on an UNALIGNED camera is the important part: its calibration maps
    pixels into a coordinate frame that camera invented for itself, not one
    shared with the other cameras being fused. The resulting zone looks exactly
    as valid as a correct one and only reveals itself when fused counts come out
    quietly wrong."""
    cal = load_calibration(CALIBRATION)
    if camera not in cal:
        raise HTTPException(422, f"camera {camera!r} has no calibration in {CALIBRATION.name} -- "
                                 f"a world zone is a FLOOR-metre polygon, so the camera it was drawn "
                                 f"on must be calibrated first (POST /calibration/rect)")
    # NOTE "diag", not "diagnostics": load_calibration() renames the on-disk key
    # (features/calibration/engine.py). Reading "diagnostics" here would always be
    # missing -> always refuse, including for correctly-aligned cameras.
    if not cal[camera].get("diag", {}).get("aligned"):
        raise HTTPException(422, f"camera {camera!r} is calibrated but NOT aligned to a shared frame "
                                 f"-- converting through it would anchor this zone to camera "
                                 f"{camera}'s own invented coordinate frame, which looks valid but "
                                 f"makes fused counts silently wrong. Run POST /calibration/align "
                                 f"first (then /calibration/cross_check to confirm it took)")
    polygon_m = pixel_to_world_m(polygon_px, cal[camera]["Hinv"])
    return ([[round(float(x), 4), round(float(y), 4)] for x, y in polygon_m],
            dict(camera=camera, polygon_px=[[float(x), float(y)] for x, y in polygon_px]))


@router.post("/zones")
def post_zone(req: ZoneRequest):
    """The zone's MODE is inferred from how many cameras `sources` carries:

      1 camera  -> PIXEL zone: the polygon is checked against that one camera's
                   own raw detections. No calibration needed at all.
      2+        -> WORLD zone: the polygon is converted to floor metres via
                   `camera`'s calibration and checked against multi-camera FUSED
                   positions, so it isn't tied to any single view.

    `camera` says which camera's image the polygon was actually drawn on, and it
    MUST be one of `sources`. Without that check you can draw on one camera and
    register another: the zone saves happily and then reads 0 forever, because
    the detection loop looks up raw_boxes_by_cam[zone["camera"]] and that camera
    is never read. Silent permanent-zero is the worst failure mode here, so it's
    a 422 at the moment of the mistake instead.

    To create a PIXEL zone on a multi-camera site, send just that one camera in
    `sources` -- the registry accumulates across calls, so registering cameras
    one request at a time costs nothing."""
    name = req.name.strip()
    if not name:
        raise HTTPException(422, "empty zone name")
    if req.camera not in req.sources:
        raise HTTPException(422, f"the polygon was drawn on camera {req.camera!r}, but `sources` "
                                 f"only carries {sorted(req.sources)} -- send that camera's feed "
                                 f"too, otherwise this zone can never be read")

    warnings = []
    world = len(req.sources) > 1
    if world:
        polygon_m, converted_from = _to_world(name, req.camera, req.polygon)

    with _zones_lock:
        try:
            if world:
                add_world_zone(_zones, name, polygon_m, converted_from=converted_from)
            else:
                add_pixel_zone(_zones, name, req.camera, req.polygon)
        except ValueError as e:
            raise HTTPException(422, str(e))
        save_zones(_zones, ZONES)
    # Re-posting a name (especially switching its mode) leaves a cached count
    # from a different measurement entirely -- pixel foot-points vs fused floor
    # positions -- which would suppress or fabricate the next change broadcast.
    _last_counts.pop(name, None)

    with _sources_lock:
        _sources.update(req.sources)
        known = sorted(_sources)

    if world:
        # A world zone is counted against FUSED positions, and fusion needs
        # agreement from MIN_CAMERAS views. Fewer calibrated cameras than that
        # and the zone reads 0 forever with nothing anywhere reporting an error.
        n_calibrated = len([c for c in known if c in load_calibration(CALIBRATION)])
        if n_calibrated < MIN_CAMERAS:
            warnings.append(f"only {n_calibrated} of the {len(known)} registered cameras are "
                            f"calibrated, but fusion needs {MIN_CAMERAS} (zoning.min_cameras in config.json) to "
                            f"agree -- this zone will count 0 until that many are calibrated")

    out = {"name": name, "mode": "world" if world else "pixel", "saved": str(ZONES),
           "sources_known": known, "warnings": warnings}
    if world:
        out["polygon_m"] = polygon_m
        out["converted_from"] = converted_from
    return out


@router.delete("/zones/{name}")
def delete_zone(name: str):
    with _zones_lock:
        try:
            remove_zone(_zones, name)
        except KeyError:
            raise HTTPException(404, f"no such zone: {name!r}")
        save_zones(_zones, ZONES)
    _last_counts.pop(name, None)
    return {"name": name, "deleted": True}


@router.websocket("/occupancy/stream")
async def occupancy_stream(ws: WebSocket, threshold: int = 0):
    """Server push only, change-triggered: connect and you immediately get
    the current known state of every zone at/above `threshold` (a
    `{"type": "snapshot", ...}` message), then one `{"type": "update",
    "zone", "count", "points"}` message each time a zone's count crosses
    that threshold in either direction, or changes while already above it --
    not a fixed-interval heartbeat, and not every reading regardless of
    relevance. `?threshold=3` (default 0, i.e. every change) means "only
    bother me once 3+ people are in a zone" -- but you'll still get told
    when it drops back below, so your last-known state never goes stale.
    The backend can connect, disconnect, and reconnect at will; the
    background detection loop keeps running either way."""
    await ws.accept()
    _ws_clients[ws] = threshold
    try:
        snapshot = {name: state for name, state in _last_counts.items() if state["count"] >= threshold}
        await ws.send_json({"type": "snapshot", "zones": snapshot})
        while True:
            # bare receive() returns a dict and does NOT raise on disconnect --
            # only receive_text()/receive_json() do that. Must check the type
            # and break manually, otherwise the next receive() call after a
            # disconnect hits Starlette's "cannot call receive() again" RuntimeError.
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.pop(ws, None)
