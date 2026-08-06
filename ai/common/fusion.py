"""Multi-camera detection fusion: per-camera boxes -> anonymous floor positions.

Used by features/zoning to count people in a `world`-mode zone, where the whole
point is that a position is agreed on by several cameras rather than taken from
one view. Pixel-mode zones never touch this.

VENDORED, DELIBERATELY. This is a copy of the fusion half of
evaluation/score_wildtrack.py (`fuse_camera_boxes`, `_cluster`, `in_region`).
The copy exists so that features/ has no dependency on evaluation/ -- this
package is meant to be dropped into any project on its own, and the tracking
research harness is not part of what ships. The maths is unchanged; only the
`image_to_world` import differs (features' own copy in
features/calibration/engine.py, verified byte-identical to
evaluation/wildtrack.py's).

IF THE CLUSTERING RULE EVER CHANGES, change it in BOTH places. The other copy is
evaluation/score_wildtrack.py, which is the archived research harness scored
against WILDTRACK ground truth -- different lifecycle, same algorithm.

Note this half needs nothing but numpy: the scipy and evaluation.metrics imports
in the original file belong to its scoring half, not to fusion.
"""
import numpy as np

from ..calibration.engine import image_to_world

FUSE_DIST = 60.0      # cm; cluster per-camera foot points into one person
                      # (WILDTRACK's p1 inter-person distance is 75cm, so 60 is
                      # below the distance at which two real people get merged)

# An optional bounding box on the floor, in cm. Detections outside it are
# discarded before clustering. Only meaningful for a dataset with an annotated
# region (WILDTRACK's 480x1440 grid of 2.5cm cells); features/zoning passes
# region=None, since a real site has no such boundary.
REGION = dict(xmin=-300.0, xmax=900.0, ymin=-900.0, ymax=2700.0, margin=100.0)


def in_region(xy, region=REGION):
    m = region["margin"]
    return (region["xmin"] - m <= xy[0] <= region["xmax"] + m
            and region["ymin"] - m <= xy[1] <= region["ymax"] + m)


def _cluster(pts, members, fuse_dist=FUSE_DIST):
    """Single-linkage clustering of floor points, with one hard constraint: two
    points from the SAME camera are never merged. One camera physically cannot
    see one person twice, so a cluster containing two boxes from one view would
    have to be two different people."""
    if not pts:
        return []
    pts = np.array(pts, float)

    n = len(pts)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    order = []
    D = np.linalg.norm(pts[:, None] - pts[None], axis=2)
    for i in range(n):
        for j in range(i + 1, n):
            if D[i, j] <= fuse_dist:
                order.append((D[i, j], i, j))
    order.sort()
    cams_of = {i: {members[i][0]} for i in range(n)}
    for d, i, j in order:
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        if cams_of[ri] & cams_of[rj]:
            continue                                     # would put one camera twice in a cluster
        parent[ri] = rj
        cams_of[rj] = cams_of[ri] | cams_of[rj]

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    out = []
    for idxs in groups.values():
        p = pts[idxs].mean(axis=0)
        out.append((float(p[0]), float(p[1]), [members[i] for i in idxs]))
    return out


def fuse_camera_boxes(cam_boxes, cal, fuse_dist=FUSE_DIST, region=REGION, min_cameras=1):
    """[(cam, (x1,y1,x2,y2)), ...] -> [(x_cm, y_cm, [(cam, box), ...]), ...].

    Each box's bottom-centre is taken as the person's feet, projected onto the
    floor through that camera's homography, then clustered across cameras.

    min_cameras: drop fused positions supported by fewer than this many distinct
    cameras. With a real detector, single-camera support is the signature of a
    false positive -- a genuine person standing where several views overlap is
    almost always seen by more than one. This is the multi-view consensus rule,
    and it is why a world zone reads 0 on a site with only one calibrated
    camera."""
    pts, members = [], []
    for cam, box in cam_boxes:
        if cam not in cal:
            continue
        foot = ((box[0] + box[2]) / 2.0, box[3])         # bottom-centre = feet
        w = image_to_world(cal[cam]["Hinv"], foot)
        if region is not None and not in_region(w, region):
            continue
        pts.append(w)
        members.append((cam, tuple(box[:4])))
    fused = _cluster(pts, members, fuse_dist)
    if min_cameras > 1:
        fused = [d for d in fused if len({c for c, _ in d[2]}) >= min_cameras]
    return fused
