"""Tunable settings, from features/config.json.

There are exactly three ways anything in this package is configured, and
environment variables are deliberately not one of them:

1. **Fixed** -- file locations (see paths.py). Nothing to configure: the data
   lives beside the code, so the service behaves the same however it is
   launched. An env-var'd path is the classic way to half-configure a
   deployment and not notice.
2. **config.json** -- values you set once for a site: detector confidence,
   image size, poll interval, the wanted-list threshold. Edited on disk,
   read once at startup, visible at GET /config.
3. **An API call** -- values that need changing while it runs, e.g.
   PUT /wanted/threshold, which takes effect on the next detection cycle.
   These are process-lifetime only; config.json remains the durable default,
   so a restart returns to it.

config.json may be partial or absent -- anything missing falls back to DEFAULTS
below, so a fresh copy of this package runs with no configuration at all.

Unknown keys are reported rather than ignored: a typo like "confidence" instead
of "conf" would otherwise look like it worked while changing nothing.
"""
import json

from .paths import CONFIG_FILE

# Every tunable, with the value each feature was actually verified at. The
# reasoning behind the non-obvious ones lives in the engine that uses them --
# fire's 1280 and wanted's 0.50 in particular are measured, not preferences.
DEFAULTS = {
    # Which RUNTIME the shared person detector uses (zoning and
    # person_tracking both pull from it). The model is always the same
    # yolo11m_multi.pt -- this only changes what executes it.
    #
    # "auto" picks: cuda -> openvino (Intel GPU) -> ncnn (ARM/Pi) -> pytorch.
    # See common/accelerated_detector.py for the ladder and its measurements
    # (openvino on the Intel iGPU is 2.40x here, identical boxes). Pin it to
    # a specific backend only to reproduce a problem -- a hand-set value is
    # how a deployment ends up on the slow path without anyone noticing.
    "detector": {
        "backend": "auto",   # "auto"|"cuda"|"openvino"|"ncnn"|"pytorch"
    },
    "zoning": {
        "weights": None,          # null -> download the project detector on first use
        "imgsz": 1280,
        "conf": 0.25,
        "update_interval": 2.0,
        # world-mode zones read live positions from person_tracking instead
        # of running their own fusion -- see features/zoning/api.py's
        # docstring. fuse_dist/min_cameras used to live here; the equivalent
        # knobs are now person_tracking's own (gate_pw, cam_support_min, etc).
    },
    "weapon": {"conf": 0.25, "imgsz": 640, "update_interval": 2.0},
    "fire": {"conf": 0.25, "imgsz": 1280, "update_interval": 2.0},   # 1280 is measured, see engine
    "emotion": {"det_size": 640, "update_interval": 2.0},
    "face": {
        # Which InsightFace pack backs face DETECTION and EMBEDDING for
        # /face, /wanted, and (through detect_faces()) /emotion's face step.
        # "buffalo_s" (SCRFD 500M detector + MobileFaceNet, ~120MB) is the
        # CPU/Raspberry-Pi-friendly default this project has used from the
        # start. "buffalo_l" (SCRFD 10G + ResNet50, ~330MB) detects real
        # faces buffalo_s misses -- up close, at an angle, not just distant
        # ones -- at a real compute cost this project's Pi 4 target cannot
        # absorb, which is why it isn't the default here.
        #
        # CROSS-PACK GALLERIES DO NOT MATCH RELIABLY. Both packs emit
        # 512-d embeddings, so nothing crashes if you enroll under one and
        # scan under another -- but the two are DIFFERENT embedding
        # spaces (different recognition networks), and identify() will
        # silently under-match across them. Changing this value means
        # RE-ENROLLING everyone in the gallery, not just restarting.
        "pack": "buffalo_s",
    },
    "wanted": {
        "threshold": 0.50,        # measured open-set operating point, see engine
        "min_face_px": 30,
        "det_size": 640,
        "update_interval": 2.0,
        "confirm_cycles": 2,      # sightings before alerting
        "hold_cycles": 5,         # consecutive misses before the all-clear
    },
    "employee_activity": {
        "poll_interval": 2.0,
        # How long a bound zone must be CONTINUOUSLY empty before a
        # workstation flips to "away" -- see employee_activity/tracker.py.
        # 300s (5 min) is a starting default, not a measured one (unlike
        # e.g. wanted's 0.50 threshold): there is no ground truth yet for
        # what counts as "stepped away" vs "not working" in this project's
        # real deployment. Tune per site.
        "absence_seconds": 300.0,
    },
    "person_tracking": {
        "weights": None,          # null -> shared with zoning, download on first use
        "conf": 0.25,
        "update_interval": 2.0,
        # Every value below mirrors architectures/pom_fusion/generic_pipeline.py's
        # own CLI flags, at their validated defaults -- see that module's
        # constants block for the full derivation of each. All are multiples of
        # this scene's own measured person_scale (or seconds), never absolute
        # units -- see person_tracking/engine.py.
        "gate_pw": 54.2 / 33.09,      # GATE_PW -- primary Hungarian match gate
        "revive_pw": 5.5,             # REVIVE_GATE_PW -- revival match gate
        "dup_guard_pw": 0.85,         # DUP_GUARD_PW -- on by default (largest AssA lever)
        "max_lost_s": 24.0,           # MAX_LOST_S -- seconds a lost track stays revivable
        "stale_gate_s": 0.4,          # STALE_GATE_S -- on by default (paired with revive_pw)
        "room_trim_pct": 1.0,         # percentile trim deriving room extent from bootstrap samples
        "cam_support_min": 2,         # cameras that must agree before reporting a person
        "peak_min": 0.55,             # minimum summed evidence for a detection peak
        "foot_sigma_pw": 24.0 / 33.09,  # FOOT_SIGMA_PW -- foot-position evidence std-dev
        "diffusion_revive": False,    # off -- measured worse on ground truth, see engine.py
    },
}


def _merge(defaults, override, where):
    out = dict(defaults)
    for k, v in override.items():
        if k not in defaults:
            print(f"[config] ignoring unknown key {where}.{k!r} in {CONFIG_FILE.name} "
                  f"-- valid keys: {sorted(defaults)}")
            continue
        if defaults[k] is not None and v is not None and not isinstance(v, type(defaults[k])):
            # int where a float is expected is fine; anything else is a real mistake
            if not (isinstance(defaults[k], float) and isinstance(v, int)):
                raise TypeError(f"{CONFIG_FILE.name}: {where}.{k} should be "
                                f"{type(defaults[k]).__name__}, got {v!r}")
        out[k] = v
    return out


def load():
    """-> the effective config: DEFAULTS with config.json merged over the top."""
    if not CONFIG_FILE.exists():
        return {k: dict(v) for k, v in DEFAULTS.items()}
    raw = json.load(open(CONFIG_FILE, encoding="utf-8"))
    cfg = {}
    for feature, defaults in DEFAULTS.items():
        cfg[feature] = _merge(defaults, raw.get(feature, {}), feature)
    for feature in raw:
        if feature not in DEFAULTS:
            print(f"[config] ignoring unknown section {feature!r} in {CONFIG_FILE.name} "
                  f"-- valid sections: {sorted(DEFAULTS)}")
    return cfg


CONFIG = load()
