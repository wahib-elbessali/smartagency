"""Tiny shared helper for reading a single frame (or metadata) out of a video
SOURCE -- an RTSP camera URL or a local file path, cv2.VideoCapture treats
both identically. Used by both features/calibration/api.py and
features/zoning/api.py, which both need to serve a frame to a frontend for
click-context and both need a live per-camera read for their respective
compute endpoints -- pulled out here once rather than duplicated in each.
"""
import cv2


def read_frame(source, index=None):
    """-> HxWx3 uint8 BGR frame, or None if the source can't be opened or the
    requested index can't be read. index=None reads whatever frame the
    source is currently positioned at (frame 0 for a fresh capture)."""
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        return None
    if index is not None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def video_meta(source):
    """-> {"n_frames": int, "fps": float, "width": int, "height": int}, or
    None if the source can't be opened."""
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        return None
    meta = dict(
        n_frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        fps=cap.get(cv2.CAP_PROP_FPS) or 25.0,
        width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    )
    cap.release()
    return meta
