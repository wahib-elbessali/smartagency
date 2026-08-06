"""Deployable surface over engine.py, mounted at /face by the unified app in
main.py.

- POST   /face/enroll       -- name + one photo in, added to the gallery.
- GET    /face/faces        -- every enrolled person + their full embedding
                           vectors (e.g. so the backend can mirror this
                           gallery into its own database).
- DELETE /face/faces/{name} -- removes a person's ENTIRE gallery entry.
- POST   /face/scan         -- event-triggered recognition for access control:
                           given a video SOURCE (an RTSP camera URL, or a
                           file path for testing), opens it, watches it until
                           a face is found (or `timeout_seconds` elapses),
                           and returns the result directly in the response
                           (blocking -- see below for why). Deliberately has
                           NO concept of "gates" -- the backend already
                           knows which camera belongs to which physical
                           gate, so it sends us the raw source and gets the
                           answer back on the same request; nothing
                           gate-specific is stored here.

This gallery (face_gallery.json) is SEPARATE from wanted_detection's watchlist
(wanted_gallery.json), and the routes are named differently on purpose so the
two can't be confused. Since the unified app runs both in one process, that file
separation and the distinct route names are now the whole of the isolation
between "enrolled employee" and "wanted person" -- there is no longer a process
or port boundary.

/scan is a plain blocking request/response, not a callback: the caller's
HTTP request just stays open for up to `timeout_seconds` while we scan, then
we reply directly. This was a deliberate choice over a callback/webhook --
since the backend is expected to handle requests concurrently (async or
multi-worker, as any real backend would), one gate's scan sitting open for
15s doesn't stop the backend from handling other gates or unrelated work at
the same time, and this way the backend doesn't need to build a receiving
endpoint at all.
"""
import threading
import time

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..paths import FACE_GALLERY
from ..face_recognition.engine import detect_faces, enroll, identify, load_gallery, save_gallery

router = APIRouter(prefix="/face", tags=["face recognition"])

_gallery = load_gallery(FACE_GALLERY)
_gallery_lock = threading.Lock()

_active_scans = set()  # sources currently being scanned -- guards a double activation
_active_scans_lock = threading.Lock()

DEFAULT_SCAN_TIMEOUT = 15.0


def _decode_image(raw_bytes):
    """raw_bytes: an encoded image file (jpg/png) as bytes, e.g. from an
    UploadFile. -> HxWx3 uint8 BGR, or None if the bytes aren't a decodable image."""
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@router.post("/enroll")
def enroll_endpoint(name: str = Form(...), image: UploadFile = File(...)):
    """multipart/form-data: name (str) + image (one photo, exactly one face).
    -> {"name": ..., "embeddings_count": N} -- N counts every photo ever
    enrolled for this name, including from earlier calls."""
    img = _decode_image(image.file.read())
    if img is None:
        raise HTTPException(400, "could not decode image")
    with _gallery_lock:
        try:
            enroll(_gallery, name, img)
        except ValueError as e:
            raise HTTPException(422, str(e))
        save_gallery(_gallery, FACE_GALLERY)
        count = len(_gallery[name])
    return {"name": name, "embeddings_count": count}


@router.get("/faces")
def list_faces():
    """-> [{"name": str, "embeddings": [[512 floats], ...]}, ...] -- the full
    gallery, e.g. for the backend to mirror into its own database."""
    with _gallery_lock:
        return [{"name": name, "embeddings": [e.tolist() for e in embs]}
                for name, embs in _gallery.items()]


@router.delete("/faces/{name}")
def delete_face(name: str):
    """Removes name's ENTIRE gallery entry. -> {"name": ..., "embeddings_removed": N}."""
    with _gallery_lock:
        if name not in _gallery:
            raise HTTPException(404, f"no such person: {name!r}")
        removed = len(_gallery.pop(name))
        save_gallery(_gallery, FACE_GALLERY)
    return {"name": name, "embeddings_removed": removed}


class ScanRequest(BaseModel):
    source: str          # RTSP camera URL, or a video file path for testing
    timeout_seconds: float = DEFAULT_SCAN_TIMEOUT


def _run_scan(source, timeout_seconds):
    """Opens `source`, reads frames until one has a face or `timeout_seconds`
    elapses. -> {"source", "name" (str or None), "score" (float or None),
    "timed_out" (bool), "error" (str or None)}. `error` is set (source
    couldn't be opened at all -- bad URL, camera offline) distinctly from
    `timed_out` (source opened fine, just no face appeared in time) -- the
    caller needs to react differently to each."""
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        return {"source": source, "name": None, "score": None, "timed_out": False,
                "error": "could not open source"}
    result = {"source": source, "name": None, "score": None, "timed_out": True, "error": None}
    start = time.monotonic()
    try:
        while time.monotonic() - start < timeout_seconds:
            ok, frame = cap.read()
            if not ok:
                break  # end of file, or stream dropped
            with _gallery_lock:
                gallery_snapshot = dict(_gallery)
            faces = detect_faces(frame)
            if faces:
                name, score = identify(gallery_snapshot, faces[0]["embedding"])
                result = {"source": source, "name": name, "score": round(score, 3),
                          "timed_out": False, "error": None}
                break
    finally:
        cap.release()
    return result


@router.post("/scan")
def scan_endpoint(req: ScanRequest):
    """Blocking: opens req.source, scans for up to req.timeout_seconds, and
    returns the result directly in this response (see /scan's module-level
    docstring for why this is blocking rather than a callback). A sync `def`
    route runs in FastAPI's threadpool, so this doesn't block the event loop
    -- other requests (other gates, unrelated endpoints) are served
    concurrently while this one is in flight.
    409s if this exact source is already being scanned by another in-flight
    request (prevents a double button-press from opening two captures on the
    same camera)."""
    with _active_scans_lock:
        if req.source in _active_scans:
            raise HTTPException(409, f"already scanning source: {req.source!r}")
        _active_scans.add(req.source)
    try:
        return _run_scan(req.source, req.timeout_seconds)
    finally:
        with _active_scans_lock:
            _active_scans.discard(req.source)
