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
    "zoning": {
        "weights": None,          # null -> download the project detector on first use
        "imgsz": 1280,
        "conf": 0.25,
        "fuse_dist": 60.0,        # cm; world zones only
        "min_cameras": 2,         # world zones only -- multi-view consensus
        "update_interval": 2.0,
    },
    "weapon": {"conf": 0.25, "imgsz": 640, "update_interval": 2.0},
    "fire": {"conf": 0.25, "imgsz": 1280, "update_interval": 2.0},   # 1280 is measured, see engine
    "emotion": {"det_size": 640, "update_interval": 2.0},
    "wanted": {
        "threshold": 0.50,        # measured open-set operating point, see engine
        "min_face_px": 30,
        "det_size": 640,
        "update_interval": 2.0,
        "confirm_cycles": 2,      # sightings before alerting
        "hold_cycles": 5,         # consecutive misses before the all-clear
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
