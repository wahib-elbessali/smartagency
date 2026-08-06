# The computer-vision service

A self-contained FastAPI service exposing seven CV features over one port. **This folder has no
dependencies outside itself** — copy it into any project, install the pip requirements, and run it.

```bash
pip install -r core/ai/requirements.txt
uvicorn core.ai.main:app --host 0.0.0.0 --port 8000
```

Run from the repo root. Imports inside the package are relative, so it works under any folder name —
the command just follows the package path.

`GET /` lists every route; `/docs` is interactive OpenAPI. Full reference with payloads and
responses: `core/contracts/ai-service.md`.

## What's here

| folder | mounted at | what it does |
|---|---|---|
| `calibration/` | `/calibration` | pixel↔floor homography per camera, multi-camera alignment |
| `zoning/` | `/zoning` | headcount inside named floor polygons, pushed on change |
| `face_recognition/` | `/face` | enroll + event-triggered `/face/scan` for gate access |
| `weapon_detection/` | `/weapon` | handguns, knives — continuous alert stream |
| `fire_detection/` | `/fire` | fire, smoke — continuous alert stream |
| `emotion_detection/` | `/emotion` | customer mood at a service desk |
| `wanted_detection/` | `/wanted` | alerts when a watchlisted person appears |

Each feature is exactly two files: `engine.py` (the CV, no web concepts) and `api.py` (an
`APIRouter`, no CV logic). `main.py` mounts them all and owns the shared `/frame` and `/video_meta`.

`common/` holds the three pieces more than one feature needs — the alert broadcaster, video
reading, and multi-camera fusion.

## First run

Model weights download automatically into this folder's `models/` (~55MB total):

| feature | source |
|---|---|
| weapon | Hugging Face, project-trained Sohas fine-tune |
| zoning | Hugging Face, project-trained person detector |
| fire | GitHub release |
| face / emotion / wanted | InsightFace + hsemotion cache to `~/.insightface`, `~/.hsemotion` (library-managed, like pip's cache) |

All of it lands in `models/` **inside this package**, so a copied folder stays self-sufficient.

Everything the service **writes** goes to `data/` inside this package: `zones.json`, `site_calibration.json`,
and the two galleries. These locations are **fixed** — they do not depend on which directory you
launch from, so the service behaves identically under a shell, systemd, or Docker.

## Configuration

There are exactly three ways to configure this package, and environment variables are deliberately
not one of them:

**1. Fixed** — file locations (`paths.py`). Nothing to set. Paths that follow the working directory
are the classic way to half-configure a deployment without noticing: start the service in the wrong
place and it comes up with zero zones, serving happily, looking exactly like "nobody is in any zone".

**2. `config.json`** (in this folder) — values you set once for a site. It may be partial or absent; missing
keys fall back to built-in defaults, so a fresh copy runs unconfigured. Typos and wrong types are
reported at startup rather than silently ignored. `GET /config` shows what is actually in effect.

```json
{
  "zoning":  {"weights": null, "imgsz": 1280, "conf": 0.25,
              "fuse_dist": 60.0, "min_cameras": 2, "update_interval": 2.0},
  "weapon":  {"conf": 0.25, "imgsz": 640,  "update_interval": 2.0},
  "fire":    {"conf": 0.25, "imgsz": 1280, "update_interval": 2.0},
  "emotion": {"det_size": 640, "update_interval": 2.0},
  "wanted":  {"threshold": 0.5, "min_face_px": 30, "det_size": 640,
              "update_interval": 2.0, "confirm_cycles": 2, "hold_cycles": 5}
}
```

Two values are measured rather than chosen and shouldn't be changed casually: `fire.imgsz` of 1280
(smoke scores roughly double what it does at 640) and `wanted.threshold` of 0.50 (an open-set
operating point — see `docs/live_alerts.md` for what it buys and what it can't promise).
`zoning.weights` set to a local `.pt` path skips the 40MB download.

**3. An API call** — for what must change while running: `PUT /wanted/threshold` takes effect on the
next detection cycle. It is process-lifetime only, so `config.json` stays the durable default and a
restart returns to it.

## Two things to know before deploying

**There is no authentication.** Every endpoint is open to anyone who can reach the port. That is a
deliberate choice for an academic project, and it is not safe as-is:
`/wanted/alerts/stream` broadcasts the names of people flagged as wanted with a photo attached, and
`/face` and `/wanted` can both read out stored biometric embeddings. Put this behind an
authenticating reverse proxy with TLS before exposing it beyond a trusted LAN.

**The two gallery files are biometric data** tied to named real people —
`data/face_gallery.json` and `data/wanted_gallery.json`, alongside the zones and calibration this
service writes. **Ignore `core/ai/data/` before the first commit**, or `git add -A` commits real
people's face embeddings permanently.
