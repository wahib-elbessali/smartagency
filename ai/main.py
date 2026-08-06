"""The single deployed API. One process, one port, every feature.

    uvicorn features.main:app --host 0.0.0.0 --port 8000

Lives in features/ rather than at the repo root because everything deployed
lives under features/ -- the root holds research/tooling (architectures/,
evaluation/, experiments/, reference_ui/), which is not shipped. Named main.py
rather than api.py so the name `api.py` stays reserved for a single feature's
endpoint module; this file composes them rather than defining any of its own.

Each feature still owns its own file pair under features/<name>/ (engine.py =
the CV script, api.py = its endpoints); api.py now exposes an APIRouter instead
of its own FastAPI app, and this module mounts them all under a prefix. That
replaces the previous arrangement of seven separate services on ports 8001-8007.

WHY ONE PROCESS, beyond having one address to point a backend at: three features
(face recognition, emotion detection, wanted detection) all sit on InsightFace's
buffalo_s pack. As separate processes each loaded its own ~120MB copy; sharing
one interpreter means one copy, which is the difference between comfortable and
marginal on the Raspberry Pi 4 deployment target. Total CPU is unchanged -- the
same background loops run either way -- but memory drops sharply and there is
one lifecycle to manage instead of seven.

Route map (full detail in each feature's api.py docstring):

    GET  /                          this map, as JSON
    GET  /frame?source=&index=      one PNG frame from any source
    GET  /video_meta?source=        {n_frames, fps, width, height}

    /calibration/...                homography per camera + multi-camera alignment
    /zoning/zones, /zoning/occupancy/stream
    /face/enroll, /face/faces, /face/scan
    /weapon/sources, /weapon/alerts/stream
    /fire/sources,   /fire/alerts/stream
    /emotion/sources,/emotion/alerts/stream
    /wanted/watchlist, /wanted/threshold, /wanted/sources, /wanted/alerts/stream

/frame and /video_meta live HERE rather than in each feature because they were
six byte-identical copies of the same eight lines; they are source-agnostic
utilities, not per-feature endpoints.

NO AUTHENTICATION. Every endpoint is open to anyone who can reach the port --
a deliberate choice for an academic project, where the per-feature X-API-Key
scheme was more ceremony than it was worth. Before this is exposed to anything
beyond a trusted LAN it needs auth put back, and note that two of these streams
are more sensitive than the rest: /wanted/alerts/stream broadcasts the names of
people flagged as wanted (with a photo of them attached), and /face + /wanted
can both read out stored biometric embeddings. Put this behind an authenticating
reverse proxy with TLS, or restore the API-key dependency, before real use.
"""
import io
from contextlib import AsyncExitStack, asynccontextmanager

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .common.video_source import read_frame, video_meta as _video_meta
from .config import CONFIG
from . import paths
from .calibration import api as calibration
from .emotion_detection import api as emotion_detection
from .face_recognition import api as face_recognition
from .fire_detection import api as fire_detection
from .wanted_detection import api as wanted_detection
from .weapon_detection import api as weapon_detection
from .zoning import api as zoning

FEATURES = [calibration, zoning, face_recognition, weapon_detection,
            fire_detection, emotion_detection, wanted_detection]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Starts every feature that has background work (the four alert streams and
    zoning's occupancy loop) and stops them in reverse order on shutdown.

    AsyncExitStack rather than a hand-written try/finally chain: if the third
    feature's startup raises, the two already started are still unwound
    correctly, and no detection loop is left running against a half-built app.
    Features with no background work (calibration, face recognition) simply
    don't define `lifespan`."""
    async with AsyncExitStack() as stack:
        for feature in FEATURES:
            if hasattr(feature, "lifespan"):
                await stack.enter_async_context(feature.lifespan())
        yield


app = FastAPI(
    title="smartAgencyAI",
    description="Computer-vision layer of the Système de Gestion des Agences.",
    lifespan=lifespan,
)

for feature in FEATURES:
    app.include_router(feature.router)


@app.get("/", tags=["meta"])
def index():
    """Every mounted path, so a backend can discover the surface without the
    OpenAPI schema (which is also served, at /docs)."""
    routes = []
    for r in app.routes:
        if r.path.startswith(("/openapi", "/docs", "/redoc")):
            continue
        routes.append({"path": r.path,
                       "methods": sorted(getattr(r, "methods", None) or ["WEBSOCKET"])})
    return {"service": "smartAgencyAI", "features": [f.router.prefix for f in FEATURES],
            "routes": sorted(routes, key=lambda x: x["path"])}


@app.get("/config", tags=["meta"])
def get_config():
    """The effective tunables, and where the service keeps its data.

    Read-only: config.json is edited on disk and read once at startup. The one
    value changeable while running is the wanted-list threshold, via
    PUT /wanted/threshold -- everything else takes a restart, deliberately, so
    that what a running service is doing always matches what the file says."""
    return {"config": CONFIG,
            "config_file": str(paths.CONFIG_FILE),
            "data_dir": str(paths.DATA),
            "models_dir": str(paths.MODELS)}


@app.get("/frame", tags=["meta"])
def get_frame(source: str, index: int | None = None):
    """?source=<path or rtsp url>&index=<optional frame number> -> one PNG.
    Shared by every feature -- a camera preview isn't feature-specific."""
    frame = read_frame(source, index)
    if frame is None:
        raise HTTPException(404, f"could not read a frame from source: {source!r}")
    ok, buf = cv2.imencode(".png", frame)
    return StreamingResponse(io.BytesIO(buf.tobytes()), media_type="image/png")


@app.get("/video_meta", tags=["meta"])
def get_video_meta(source: str):
    """?source=... -> {n_frames, fps, width, height}."""
    meta = _video_meta(source)
    if meta is None:
        raise HTTPException(404, f"could not open source: {source!r}")
    return meta
