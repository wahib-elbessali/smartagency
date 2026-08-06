"""Face-recognition primitive -- enroll + identify -- the AI/CV script behind
this feature's API (features/face_recognition/api.py). features/<name>/ holds
only what's actually deployed: the CV script(s) + the endpoint(s) that expose
them, nothing else (no CLIs, no one-off validation scripts -- those live
elsewhere, see below).

Backed by InsightFace's "buffalo_s" pack (SCRFD detector + MobileFaceNet
recognition, ~120MB, CPU-friendly via onnxruntime) -- same reasoning as
CLAUDE.md's yolov8n-nano choice: this project runs on CPU everywhere
(dev machine and the Raspberry Pi 4 deployment target), so pick the smallest
model that clears the accuracy bar, not the most accurate one available.
Accuracy validated against real labeled data (LFW pairs) in
evaluation/face_id_lfw_eval.py, not just "looks right" -- see that file for
the chosen similarity threshold's justification.

Gallery format: JSON, {"people": {name: [[512 floats], ...]}} -- multiple
embeddings per person (multiple enrollment photos) improve robustness to
pose/lighting; identify() takes the best match over ALL of a person's stored
embeddings. Deliberately NOT tracked in git (see .gitignore) -- unlike zone
polygons or calibration numbers, this file is biometric data tied to named
real people.
"""
import json
import pathlib as _pl
import numpy as np

_ENGINE = None  # lazy singleton -- loading the model pack takes ~1s, don't repeat per call


def get_engine(det_size=(640, 640)):
    """Lazy-loaded FaceAnalysis, CPU-only. Reused across calls in one process."""
    global _ENGINE
    if _ENGINE is None:
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=det_size)
        _ENGINE = app
    return _ENGINE


def detect_faces(image_bgr, det_size=(640, 640)):
    """image_bgr: HxWx3 uint8, OpenCV convention (as from cv2.imread/VideoCapture).
    -> list of {"bbox": (x1,y1,x2,y2), "det_score": float, "embedding": (512,) float32 L2-normalized}
    sorted by det_score descending."""
    app = get_engine(det_size)
    faces = app.get(image_bgr)
    out = [
        dict(bbox=tuple(float(v) for v in f.bbox), det_score=float(f.det_score),
             embedding=f.normed_embedding.astype(np.float32))
        for f in faces
    ]
    out.sort(key=lambda f: -f["det_score"])
    return out


def load_gallery(path):
    """-> {name: [embedding, ...]} (each embedding a (512,) float32 array).
    Missing file -> empty gallery (a fresh site has enrolled no one yet)."""
    p = _pl.Path(path)
    if not p.exists():
        return {}
    d = json.load(open(p))
    return {name: [np.array(e, dtype=np.float32) for e in embs]
            for name, embs in d.get("people", {}).items()}


def save_gallery(gallery, path):
    d = {"people": {name: [e.tolist() for e in embs] for name, embs in gallery.items()}}
    json.dump(d, open(path, "w"), indent=1)


def enroll(gallery, name, image_bgr):
    """Adds ONE embedding to gallery[name] from image_bgr. Requires exactly one
    detected face (ambiguous which face is the enrollee otherwise) -- raises
    ValueError if zero or multiple faces are found, since silently picking
    "the biggest face" would enroll the wrong person on a bad photo without
    any signal that something went wrong.
    -> the gallery dict (mutated in place, also returned for chaining)."""
    faces = detect_faces(image_bgr)
    if len(faces) != 1:
        raise ValueError(f"expected exactly 1 face for enrollment, found {len(faces)}")
    gallery.setdefault(name, []).append(faces[0]["embedding"])
    return gallery


def identify(gallery, embedding, threshold=0.248):
    """embedding: (512,) L2-normalized, as returned by detect_faces().
    -> (name, score) for the best match across every person's every stored
    embedding, or (None, best_score) if nothing clears `threshold`.
    Cosine similarity, since embeddings are L2-normalized (equivalent to a
    plain dot product). threshold=0.248 measured by evaluation/face_id_lfw_eval.py
    on 1000 real LFW same/different-person pairs: AUC 0.998, and this specific
    value gives 0/500 false accepts (FPR=0.000) at 98.8% recall (TPR) -- LFW is
    "in the wild" photos, harder than a real controlled entry camera, so this
    is a conservative floor, not an optimistic one."""
    best_name, best_score = None, -1.0
    for name, embs in gallery.items():
        score = max(float(np.dot(embedding, e)) for e in embs)
        if score > best_score:
            best_name, best_score = name, score
    if best_score < threshold:
        return None, best_score
    return best_name, best_score
