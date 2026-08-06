# AI/CV Service Contract

One process, one port: `uvicorn ai.main:app --port 8000` (run from the repo root). Seven features
mounted under per-feature prefixes, plus three app-level routes.

**No authentication.** Every endpoint is open to anyone who can reach the port — there is no API
key, no token, no header to send. Two surfaces make this a deployment constraint rather than a
convenience: `/wanted/alerts/stream` broadcasts the names of people flagged as wanted **with a photo
of them attached**, and `/face` and `/wanted` both read out stored biometric embeddings. This
service must sit behind an authenticating reverse proxy with TLS; it is not safe on an open network.

**Configuration is a file, not environment variables.** The service reads none. Tunables
(detector confidence, image sizes, poll intervals, the wanted-list threshold) live in
`ai/config.json` and are read once at startup — see `GET /config`. File locations are fixed
inside the package and are not configurable at all. The single value changeable at runtime is
`PUT /wanted/threshold`.

**Everything the service writes** — zones, calibration, both face galleries — goes to
`ai/data/`, a fixed path relative to the package. It does **not** follow the working
directory, so the service behaves identically under a shell, systemd or Docker. A fresh install
starts empty.

---

## App-level

### GET /
**Owner:**
**Type:** REST
**Payload:** none
**Returns:**
```json
{"service": "smartAgencyAI",
 "features": ["/calibration", "/zoning", "/face", "/weapon", "/fire", "/emotion", "/wanted"],
 "routes": [{"path": "/frame", "methods": ["GET"]}, "…"]}
```
**Notes:** Route map, so a caller can discover the surface without parsing OpenAPI (also served at `/docs`).

### GET /frame
**Owner:**
**Type:** REST
**Payload:** query `?source=<rtsp url or file path>&index=<optional frame number>`
**Returns:** `200 image/png` — the raw frame bytes (not JSON)
**Notes:** `404` if the source can't be opened or that frame can't be read. `index` omitted = whatever frame the source is currently at (frame 0 for a fresh open on a file; the live frame on RTSP). Shared by every feature — how a frontend gets something to click on for calibration points / zone polygons.

### GET /video_meta
**Owner:**
**Type:** REST
**Payload:** query `?source=...`
**Returns:**
```json
{"n_frames": 2955, "fps": 25.0, "width": 360, "height": 288}
```
**Notes:** `404` if unopenable. `fps` falls back to `25.0` if the source reports none.

### GET /config
**Owner:**
**Type:** REST
**Payload:** none
**Returns:**
```json
{"config": {
   "zoning":  {"weights": null, "imgsz": 1280, "conf": 0.25,
               "fuse_dist": 60.0, "min_cameras": 2, "update_interval": 2.0},
   "weapon":  {"conf": 0.25, "imgsz": 640,  "update_interval": 2.0},
   "fire":    {"conf": 0.25, "imgsz": 1280, "update_interval": 2.0},
   "emotion": {"det_size": 640, "update_interval": 2.0},
   "wanted":  {"threshold": 0.5, "min_face_px": 30, "det_size": 640,
               "update_interval": 2.0, "confirm_cycles": 2, "hold_cycles": 5}},
 "config_file": "…/ai/config.json",
 "data_dir":    "…/ai/data",
 "models_dir":  "…/ai/models"}
```
**Notes:** Read-only — the effective settings, and where the service keeps its data and weights. `config.json` is edited on disk and read once at startup, so this is also how you confirm a running service is actually using the config you think it is. The only value changeable without a restart is the wanted threshold (`PUT /wanted/threshold`).

---

## /calibration — pixel ↔ floor geometry (one-time per-site setup)

### GET /calibration
**Owner:**
**Type:** REST
**Payload:** none
**Returns:**
```json
{"0": {"Hinv": [[0.1169, 0.0100, -18.37],
                [0.0085, 0.3675, -159.07],
                [0.0000, 0.0002, 0.9038]],
       "diagnostics": {"n_points": 4, "px_err_mean": 2.9e-13, "px_err_max": 3.4e-13,
                       "aligned": true, "aligned_to": "0", "aligned_with_n_points": 2,
                       "note": "…"}}}
```
**Notes:** One entry per calibrated camera. `Hinv` maps image pixels → floor centimetres. `diagnostics.aligned` is the flag that decides world-zone eligibility. `{}` when nothing is calibrated yet.

### POST /calibration/rect
**Owner:**
**Type:** REST
**Payload:**
```json
{"camera": "0", "points": [[120,430],[980,410],[1010,700],[95,720]]}
```
**Returns:**
```json
{"n_points": 4, "px_err_mean": 2.9e-13, "px_err_max": 3.4e-13, "aligned": false,
 "note": "4-point exact fit: 0 reprojection error is expected regardless of whether the
          right-angle assumption is actually true -- it does not validate accuracy…"}
```
**Notes:** Fits a homography from 4 points assumed to form a real-life right angle. `422` if not exactly 4 points or near-collinear. Result is `aligned: false` until `/calibration/align` reconciles it into the shared frame — a fresh camera's coordinate frame is private to itself. **Do not treat `px_err_*` as validation:** a 4-point exact fit always reports ~0 error by construction, whether or not the right-angle assumption was true. It tells you the maths ran, nothing more.

### POST /calibration/align
**Owner:**
**Type:** REST
**Payload:**
```json
{"points": [{"0": [512,300], "1": [140,290]}, {"1": [820,150], "2": [110,180]}]}
```
**Returns:**
```json
{"reference": "0",
 "results": {"0": {"aligned": true,  "reference": true,  "n_points": null, "via": null},
             "1": {"aligned": true,  "reference": false, "n_points": 2,    "via": "0"},
             "2": {"aligned": false, "reference": false, "n_points": 0,    "via": null,
                   "error": "no chain of >=2-point camera pairs connects this camera back
                             to the reference -- record more shared points involving it"}},
 "residual_checks": [{"pairs": [{"cam_a": "0", "cam_b": "1", "distance_cm": 0.0}]}]}
```
**Notes:** Send the **full accumulated list** of shared-point observations across cameras (not a delta). BFS from the lowest-id camera; any camera sharing ≥2 points with an aligned one gets tied in. `400` if fewer than 2 cameras calibrated. **Check `results` per camera** — a camera that couldn't be reached comes back `aligned: false` with an `error` string, and the call still returns `200`. `residual_checks` shows how far apart the cameras now place each recorded point; small numbers mean the alignment took.

### POST /calibration/cross_check
**Owner:**
**Type:** REST
**Payload:**
```json
{"points": {"0": [512,300], "1": [140,290]}}
```
**Returns:**
```json
{"worlds": {"0": [45.7, -45.6], "1": [45.7, -45.6]},
 "pairs":  [{"cam_a": "0", "cam_b": "1", "distance_cm": 0.0}]}
```
**Notes:** Read-only verification — click the same real point in ≥2 already-aligned cameras, get back how far apart they place it (`distance_cm`, floor centimetres). Use different points than the ones used to align, otherwise you are checking the fit against its own training data. `422` if any named camera is uncalibrated/unaligned.

### DELETE /calibration/{camera}
**Owner:**
**Type:** REST
**Payload:** none
**Returns:** `{"camera": "0", "deleted": true}`
**Notes:** `404` if unknown. Persisted to `ai/data/site_calibration.json` — a **fixed** path inside the package, not relative to the working directory.

---

## /zoning — headcount inside floor polygons (no identities/trajectories)

### POST /zoning/zones
**Owner:**
**Type:** REST
**Payload:**
```json
{"name": "lobby", "camera": "0",
 "polygon": [[100,200],[400,200],[400,500],[100,500]],
 "sources": {"0": "rtsp://…", "1": "rtsp://…"}}
```
**Returns (pixel — one camera in `sources`):**
```json
{"name": "till", "mode": "pixel", "saved": "…/ai/data/zones.json",
 "sources_known": ["0"], "warnings": []}
```
**Returns (world — two or more):**
```json
{"name": "lobby", "mode": "world", "saved": "…/ai/data/zones.json",
 "sources_known": ["0", "1"], "warnings": [],
 "polygon_m": [[-0.0491,-0.8926],[0.3197,-0.8629],[0.3287,0.2762],[-0.0161,0.2517]],
 "converted_from": {"camera": "0",
                    "polygon_px": [[100,200],[400,200],[400,500],[100,500]]}}
```
**Notes:** Single endpoint for both zone kinds — mode is inferred from `sources` count: 1 camera → `pixel` mode (no calibration needed), 2+ → `world` mode (needs the drawn-on camera calibrated **and** aligned, else `422`). `mode` is always echoed back, so never infer which branch you got. `camera` must be one of `sources` or `422` (prevents a silent-permanent-zero misconfiguration). `sources` is the only way this service learns a camera's live feed URL — it accumulates across calls. Re-posting an existing `name` overwrites it, including mode. To create a *pixel* zone on a multi-camera site, send only that one camera; the registry accumulates, so registering cameras one call at a time costs nothing.

**Check `warnings` — it is not decorative.** A world zone still saves (`200`) when fewer than `min_cameras` (default 2) of the registered cameras are calibrated, but returns e.g. `"only 1 of the 2 registered cameras are calibrated, but fusion needs 2 … this zone will count 0 until that many are calibrated"`. Ignore it and you get a zone that permanently reads zero with no error anywhere.

### GET /zoning/zones
**Owner:**
**Type:** REST
**Payload:** none
**Returns:**
```json
{"till":  {"mode": "pixel", "camera": "0",
           "polygon_px": [[100,200],[400,200],[400,500],[100,500]]},
 "lobby": {"mode": "world",
           "polygon_m": [[-0.0491,-0.8926],[0.3197,-0.8629],[0.3287,0.2762],[-0.0161,0.2517]],
           "converted_from": {"camera": "0", "polygon_px": [[100,200],[400,200],[400,500],[100,500]]}}}
```
**Notes:** Pixel zones carry `camera` + `polygon_px`; world zones carry `polygon_m` (floor metres, no camera — they aren't tied to one view) + `converted_from` provenance back to what was actually drawn. `{}` when no zones exist.

### DELETE /zoning/zones/{name}
**Owner:**
**Type:** REST
**Payload:** none
**Returns:** `{"name": "lobby", "deleted": true}`
**Notes:** `404` if unknown.

### WS /zoning/occupancy/stream
**Owner:**
**Type:** WebSocket
**Payload:** optional query `?threshold=N` (default 0), per-connection
**Messages:**
```jsonc
// on connect
{"type":"snapshot","zones":{"lobby":{"count":4,"points":[[210.5,533.0]]}}}
// then, only when a count changes
{"type":"update","zone":"lobby","count":5,"points":[[210.5,533.0]]}
```
**Notes:** `points` are the positions that landed inside — floor centimetres for world zones, pixel foot-points for pixel zones. A person can be in several overlapping zones at once; boundary counts as inside. Pushed **only when a zone's count changes** — no heartbeat. Detection runs continuously once ≥1 zone + ≥1 source exist, whether or not anyone's listening. `threshold` gates when you're woken but you're still told when a zone drops back below it.

---

## /face — access control (event-triggered, request/response)

### POST /face/enroll
**Owner:**
**Type:** REST (`multipart/form-data`)
**Payload:** `name` (str) + `image` (one photo, exactly one face)
**Returns:** `{"name": "employee1", "embeddings_count": 1}`
**Notes:** `embeddings_count` is cumulative across every photo ever enrolled for that name — enrolling several photos per person improves robustness to pose and lighting. `400` undecodable image, `422` if zero or ≥2 faces found (it fails loudly rather than guessing which face you meant).

### GET /face/faces
**Owner:**
**Type:** REST
**Payload:** none
**Returns:** `[{"name": "employee1", "embeddings": [[512 floats], "…"]}]` (`[]` when empty)
**Notes:** Full gallery including raw vectors, for a backend to mirror into its own DB. Unlike `/wanted/watchlist`, embeddings are always included here.

### DELETE /face/faces/{name}
**Owner:**
**Type:** REST
**Payload:** none
**Returns:** `{"name": "employee1", "embeddings_removed": 3}`
**Notes:** `404` if unknown. Removes the person's entire entry (every enrolled photo). Touches only this gallery — the wanted watchlist is a separate file.

### POST /face/scan
**Owner:**
**Type:** REST
**Payload:**
```json
{"source": "rtsp://gate-cam", "timeout_seconds": 15}
```
**Returns — four distinct outcomes, all `200`:**
```jsonc
{"source":"rtsp://gate-cam","name":"omar","score":0.735,"timed_out":false,"error":null} // recognised
{"source":"rtsp://gate-cam","name":null,"score":0.002,"timed_out":false,"error":null}   // face seen, not recognised
{"source":"rtsp://gate-cam","name":null,"score":null,"timed_out":true, "error":null}    // source fine, nobody appeared
{"source":"nonexistent.mp4","name":null,"score":null,"timed_out":false,
 "error":"could not open source"}                                                       // camera unreachable
```
**Notes:** **Blocking** — opens the source, watches until a face appears or the timeout elapses, answers on the same request (the caller's HTTP connection stays open for up to `timeout_seconds`). `error` and `timed_out` are deliberately distinct: camera offline vs. camera fine but nobody showed, and you react differently to each. `409` if that source is already mid-scan (guards a double button-press opening two captures on one camera). `score` is cosine similarity, not a probability; match threshold `0.248` (measured on 1000 LFW pairs: AUC 0.998, 0 false accepts in 500 negatives at 98.8% true-accept). This is the endpoint a caller uses for an access-control decision on a badge tap — the grant/deny decision itself belongs to whichever service consumes this result, not to this service.

---

## The four alert streams — /weapon, /fire, /emotion, /wanted (identical shape)

Substitute `{f}` for `weapon`, `fire`, `emotion`, or `wanted`. Built on one shared implementation — learn one, you know all four; only the class vocabulary differs.

### POST /{f}/sources
**Owner:**
**Type:** REST
**Payload:**
```json
{"sources": {"cam1": "rtsp://…", "lobby": "/data/lobby.mp4"}}
```
**Returns:** `{"sources_known": ["cam1", "lobby"]}`
**Notes:** **Merges, doesn't replace** — re-posting an id updates just that camera. Detection begins the moment ≥1 source exists, and runs whether or not anyone is connected to the stream.

### GET /{f}/sources
**Owner:** · **Type:** REST · **Payload:** none · **Returns:** `{"cam1": "rtsp://…", "lobby": "/data/lobby.mp4"}` — the registry (`{}` when empty).

### DELETE /{f}/sources/{camera}
**Owner:** · **Type:** REST · **Payload:** none · **Returns:** `{"camera": "cam1", "deleted": true}` / `404`.

### WS /{f}/alerts/stream
**Owner:**
**Type:** WebSocket
**Payload:** none
**Messages:**
```jsonc
// immediately on connect
{"type":"snapshot","cameras":{"cam1":[{"class":"pistol","confidence":0.87,
                                       "bbox":[900.5,332.0,1352.5,664.7]}]}}
// then, per change
{"type":"update","camera":"cam1","detections":[{"class":"pistol","confidence":0.87,
                                                "bbox":[900.5,332.0,1352.5,664.7]}]}
```
**Notes:** **Fires only when a camera's *set of detected classes* changes — not per frame** (confidence jitter alone sends nothing). `bbox` is `[x1,y1,x2,y2]` source-frame pixels. `"detections": []` is the all-clear. A repeated identical alert means the situation genuinely changed and changed back — don't build a UI expecting periodic refreshes, or you'll conclude the service died during a long quiet period.

### /weapon classes
`pistol`, `knife`. Known flicker: pistol↔smartphone label can flip frame-to-frame on the same object — treat presence as reliable over a short window, not on one frame.

### /fire classes
`fire`, `smoke`.

### /emotion classes
`Anger`, `Contempt`, `Disgust`, `Fear`, `Happiness`, `Neutral`, `Sadness`, `Surprise` (one per face). Only trust this on a camera close to the interaction (counter/service desk) — confidence is genuinely low (0.4–0.6) on real candid footage even when working correctly; don't read sub-0.5 as "no signal."

### /wanted classes
`class` is the matched person's **name** — an open, operator-controlled vocabulary, unlike the fixed sets above, so a frontend can't hard-code per-class styling. Duplicate classes in one payload are legal (two faces both matching one name), so don't key by class. Adds the five routes below.

---

## /wanted — watchlist management (additional routes)

### POST /wanted/watchlist
**Owner:**
**Type:** REST (`multipart/form-data`)
**Payload:** `name` + `image` (exactly one face)
**Returns:** `{"name": "SUSPECT-2024-114", "embeddings_count": 1}`
**Notes:** Names restricted to `[A-Za-z0-9 ._+-]`, 1–80 chars (`422` otherwise — a `/` would be undeletable via the URL below). Deliberately different route names from `/face/enroll` — the catastrophic failure mode this guards against is enrolling someone into the wrong list, and same-shaped-but-differently-named routes can't be confused for one another the way identical ones could.

### GET /wanted/watchlist
**Owner:**
**Type:** REST
**Payload:** optional query `?include_embeddings=true`
**Returns:** `[{"name": "SUSPECT-2024-114", "embeddings_count": 2}]`, plus `"embeddings": [[512 floats], …]` when opted in
**Notes:** Embeddings are opt-in, unlike `/face/faces` which always returns them — dumping a wanted list's biometrics should be a deliberate act. `[]` when the watchlist is empty.

### DELETE /wanted/watchlist/{name}
**Owner:** · **Type:** REST · **Payload:** none · **Returns:** `{"name": "SUSPECT-2024-114", "embeddings_removed": 2}` / `404`. Touches only the watchlist — `/face`'s gallery is a separate file and provably cannot be affected.

### GET /wanted/threshold
**Owner:**
**Type:** REST
**Payload:** none
**Returns:**
```json
{"threshold": 0.5, "min_face_px": 30,
 "startup_default": {"threshold": 0.5, "min_face_px": 30},
 "floor": 0.25, "watchlist_size": 3, "embeddings_total": 7,
 "applies_within_seconds": 2.0}
```
**Notes:** `startup_default` is what `config.json` said at boot, so drift between that and the live value is visible. `watchlist_size`/`embeddings_total` are included because the safe threshold depends on them — more enrolled embeddings means more chances for any given face to false-match.

### PUT /wanted/threshold
**Owner:**
**Type:** REST
**Payload:**
```json
{"threshold": 0.58}
```
**Returns:**
```json
{"threshold": 0.3, "min_face_px": 30,
 "previous": {"threshold": 0.5, "min_face_px": 30},
 "warnings": ["0.3 is below the measured default 0.5, raising the false-accusation rate"],
 "applies_within_seconds": 2.0}
```
**Notes:** Accepts `threshold` and/or `min_face_px`; at least one required (`422` with neither). Takes effect on the next detection cycle, **not persisted** — a restart reverts to `config.json`'s value, so re-apply on boot for a standing change. `422` below the `0.25` floor (at or below the access-control-validated `0.248`, open-set matching false-alarms constantly). Lowering below the measured default succeeds but returns a `warnings` entry naming what you gave up.

### Wanted alert payload (inside the common `/wanted/alerts/stream` shape)
```json
{"class": "MAROUANE-B-2024-114", "confidence": 0.612, "bbox": [412.0,88.0,501.0,205.0],
 "det_score": 0.881, "face_px": 94, "snapshot": "<base64 jpeg>"}
```
**Notes:** `confidence` is cosine similarity in `[-1,1]` (typically 0.25–0.75), not a probability — don't render as "% confident." `snapshot` (base64 JPEG, downscaled to 960px, ~20KB, **nothing written to disk**) attaches once, to the highest-confidence detection — it is a property of the frame, not of an individual match. `face_px` is the detected face size; anything under `min_face_px` (default 30) is discarded before matching.

**Hysteresis, and what it means for your timings:** `confirm_cycles` (default 2) sightings before an alert, `hold_cycles` (default 5) consecutive misses before the all-clear. Face recognition is intermittent in a way object detection isn't — a head turn drops a face for a cycle — so without this a present person would flicker "gone" and back. Alert latency is therefore `(confirm_cycles − 1) × update_interval`, and the all-clear lags by `hold_cycles × update_interval`. Entries replayed from the hold window carry `"held": true` and a bbox that is up to that many cycles stale.

**`"detections": []` is ambiguous** between "nobody wanted is here", "no faces at all" and "camera pointed at a wall" — unknown people are deliberately never emitted, so this stream **cannot** double as a camera-liveness check. Use `GET /frame` for that.

**Unknown faces are never emitted anywhere** — not in the stream, not to disk, not to a log. An innocent passer-by's embedding exists only until it is garbage-collected.

**A match is evidence for a human to review, never an automatic action.** The 0.50 default was measured for open-set identification on LFW (200-person watchlist, 400 impostor probes): 91% of real watchlist members caught, with no *measured* false alarms — but 400 probes resolve a false-alarm rate only to 2.5e-3, so "none measured" means *below what that sample can see*, **not zero**. Face-recognition error rates are also not uniform across demographic groups, which no threshold setting can fix.
