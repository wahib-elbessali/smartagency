"""Calibration logic -- ground-plane homography fitting, multi-camera
alignment, and cross-check math. No Flask, no click-by-click server-side
state: a real frontend owns showing camera images and collecting clicked
points (reference_ui/calibration/calibration_app.py shows one way to build
that interaction, including the draggable-4th-corner UI trick -- but it's a
reference, not the deployed path). This module takes a COMPLETE set of
points per operation and returns/persists the result; see
features/calibration/api.py for the REST wrapper a frontend actually calls.

Persisted format unchanged from the original browser tool: site_calibration.json,
{"units": "cm", "cameras": {cam_id: {"Hinv": [[3x3]], "diagnostics": {...}}}}.
"""
import json
import pathlib as _pl
import numpy as np
import cv2


def load_calibration(path):
    """-> {cam_id: {"Hinv": (3,3) ndarray, "H": (3,3) ndarray, "diag": {...}}}.
    Missing file -> empty (no cameras calibrated yet)."""
    p = _pl.Path(path)
    if not p.exists():
        return {}
    d = json.load(open(p))
    cal = {}
    for cam_id, c in d.get("cameras", {}).items():
        Hinv = np.array(c["Hinv"], dtype=float)
        cal[cam_id] = dict(Hinv=Hinv, H=np.linalg.inv(Hinv), diag=c.get("diagnostics", {}))
    return cal


def save_calibration(cal, path):
    out = dict(units="cm", cameras={
        c: dict(Hinv=cal[c]["Hinv"].tolist(), diagnostics=cal[c].get("diag", {}))
        for c in cal
    })
    json.dump(out, open(path, "w"), indent=2)


def image_to_world(Hinv, uv):
    p = Hinv @ np.array([uv[0], uv[1], 1.0])
    return (p[0] / p[2], p[1] / p[2])


def fit_homography(rows):
    """rows: [(px, py, world_x_m, world_y_m), ...] -> (Hinv, diagnostics)."""
    arr = np.array(rows, dtype=float)
    px = arr[:, :2]
    wc = arr[:, 2:] * 100.0
    H, _ = cv2.findHomography(wc, px)
    if H is None:
        return None, None
    Hinv = np.linalg.inv(H)
    ones = np.ones((len(px), 1))
    proj_px = (H @ np.hstack([wc, ones]).T).T
    proj_px = proj_px[:, :2] / proj_px[:, 2:3]
    px_err = np.linalg.norm(proj_px - px, axis=1)
    return Hinv, dict(n_points=len(px), px_err_mean=float(px_err.mean()),
                      px_err_max=float(px_err.max()))


def fit_homography_rect(pixel_pts, aspect=1.0):
    """4 pixel points (in order around an ASSUMED right-angle shape) ->
    (Hinv, diagnostics). No real-world measurement -- the target is a
    canonical rectangle (default square, 1 side ~ 1m by convention), the
    assumption being the 4 points really do form a right angle in real life."""
    px = np.array(pixel_pts, dtype=float)
    target_m = np.array([[0, 0], [aspect, 0], [aspect, 1], [0, 1]], dtype=float)
    return fit_homography([(px[i, 0], px[i, 1], target_m[i, 0], target_m[i, 1])
                           for i in range(4)])


def pairwise_distances(cal, points):
    """points: {cam: [px, py]} (>=2 entries, every key already in `cal`) ->
    (worlds, pairs) using each camera's CURRENT Hinv."""
    worlds = {c: image_to_world(cal[c]["Hinv"], tuple(pt)) for c, pt in points.items()}
    cams_sorted = sorted(worlds)
    pairs = []
    for i in range(len(cams_sorted)):
        for j in range(i + 1, len(cams_sorted)):
            a, b = cams_sorted[i], cams_sorted[j]
            dist = float(np.hypot(worlds[a][0] - worlds[b][0], worlds[a][1] - worlds[b][1]))
            pairs.append(dict(cam_a=a, cam_b=b, distance_cm=round(dist, 1)))
    return worlds, pairs


def align_cameras(cal, align_points):
    """BFS from an arbitrary anchor camera (the first calibrated cam, sorted
    by id): for each not-yet-aligned camera with >=2 points shared with an
    already-aligned one, fit the similarity transform (scale+rotation+
    translation, cv2's estimateAffinePartial2D) reconciling the two cameras'
    independently-assumed frames, and bake it into the not-yet-aligned
    camera's Hinv. Runs breadth-first so two cameras that never directly
    share a point can still be tied together through a third that shares
    points with both.

    Mutates `cal` in place (each aligned camera's Hinv/H/diag updated) and
    returns a results dict -- same convention as this project's other
    gallery-style mutators (e.g. common/face_id.py's enroll()).

    align_points: [{cam: [px,py], ...}, ...] -- the FULL list of shared-point
    observations. The frontend accumulates these across however many clicks
    and sends the whole list at once; there's no incremental server-side
    banking here (unlike the original browser tool's /align_point_add)."""
    cams = sorted(cal)
    if len(cams) < 2:
        return dict(error="need >= 2 calibrated cameras")

    pair_obs = {}   # {(cam_a, cam_b): [{cam_a: [px,py], cam_b: [px,py]}, ...]}
    for pt in align_points:
        seen = sorted(c for c in pt if c in cal)
        for i in range(len(seen)):
            for j in range(i + 1, len(seen)):
                a, b = seen[i], seen[j]
                pair_obs.setdefault((a, b), []).append({a: pt[a], b: pt[b]})

    ref = cams[0]
    visited = {ref}
    queue = [ref]
    cal[ref]["diag"] = dict(cal[ref].get("diag", {}), aligned=True)
    results = {ref: dict(aligned=True, reference=True, n_points=None, via=None)}

    while queue:
        v = queue.pop(0)
        for (a, b), obs in pair_obs.items():
            if a == v and b not in visited:
                u = b
            elif b == v and a not in visited:
                u = a
            else:
                continue
            if len(obs) < 2:
                continue
            world_v = np.array([image_to_world(cal[v]["Hinv"], o[v]) for o in obs],
                               dtype=np.float32)
            world_u = np.array([image_to_world(cal[u]["Hinv"], o[u]) for o in obs],
                               dtype=np.float32)
            M, _inliers = cv2.estimateAffinePartial2D(world_u, world_v)
            if M is None:
                continue
            M_hom = np.vstack([M, [0.0, 0.0, 1.0]])
            new_Hinv = M_hom @ cal[u]["Hinv"]
            cal[u]["Hinv"] = new_Hinv
            cal[u]["H"] = np.linalg.inv(new_Hinv)
            cal[u]["diag"] = dict(
                cal[u].get("diag", {}),
                aligned=True, aligned_to=v, aligned_with_n_points=len(obs),
                note="Hinv corrected by align_cameras -- scale/rotation/translation fit "
                     "against shared points, reconciling this camera's frame with "
                     f"cam {v}'s (not a from-scratch homography fit)")
            visited.add(u)
            queue.append(u)
            results[u] = dict(aligned=True, reference=False, n_points=len(obs), via=v)

    for c in cams:
        if c not in visited:
            results[c] = dict(aligned=False, reference=False, n_points=0, via=None,
                              error="no chain of >=2-point camera pairs connects this "
                                    "camera back to the reference -- record more shared "
                                    "points involving it")

    # residual distances for every recorded point, using the now-corrected
    # Hinvs, so the caller can see the improvement directly
    residuals = [dict(pairs=pairwise_distances(cal, {c: pt[c] for c in pt if c in cal})[1])
                for pt in align_points if len(pt) >= 2]
    return dict(results=results, reference=ref, residual_checks=residuals)
