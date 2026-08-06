# AI/CV Service Contract

---

## App-level

### GET /
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** Route map — `{"service", "features": [...], "routes": [...]}`. Lets a caller discover the surface without parsing OpenAPI (also served at `/docs`).

### GET /frame
**Owner:**
**Type:** REST
**Payload:** query `?source=<rtsp url or file path>&index=<optional frame number>`
**Notes:** → `image/png`, one frame. `404` if the source can't be opened. Shared by every feature — how a frontend gets something to click on for calibration points / zone polygons.

### GET /video_meta
**Owner:**
**Type:** REST
**Payload:** query `?source=...`
**Notes:** → `{"n_frames", "fps", "width", "height"}`. `404` if unopenable. `fps` falls back to `25.0` if the source reports none.

---

## /calibration — pixel ↔ floor geometry (one-time per-site setup)

### GET /calibration
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → every camera's current calibration + diagnostics (`aligned` flag decides world-zone eligibility).

### POST /calibration/rect
**Owner:**
**Type:** REST
**Payload:**
```json
{"camera": "0", "points": [[120,430],[980,410],[1010,700],[95,720]]}
```
**Notes:** Fits a homography from 4 points assumed to form a real-life right angle. `422` if not exactly 4 points or near-collinear. Result is `aligned: false` until `/calibration/align` reconciles it into the shared frame — a fresh camera's coordinate frame is private to itself.

### POST /calibration/align
**Owner:**
**Type:** REST
**Payload:**
```json
{"points": [{"0": [512,300], "1": [140,290]}, {"1": [820,150], "2": [110,180]}]}
```
**Notes:** Send the **full accumulated list** of shared-point observations across cameras (not a delta). BFS from the lowest-id camera; any camera sharing ≥2 points with an aligned one gets tied in. `400` if fewer than 2 cameras calibrated.

### POST /calibration/cross_check
**Owner:**
**Type:** REST
**Payload:**
```json
{"points": {"0": [512,300], "1": [140,290]}}
```
**Notes:** Read-only verification — click the same real point in ≥2 already-aligned cameras, get back how far apart they place it (`distance_cm`). Use different points than the ones used to align. `422` if any named camera is uncalibrated/unaligned.

### DELETE /calibration/{camera}
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → `{"camera", "deleted": true}` / `404`. Persisted to `site_calibration.json`.

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
**Notes:** Single endpoint for both zone kinds — mode is inferred from `sources` count: 1 camera → `pixel` mode (no calibration needed), 2+ → `world` mode (needs the drawn-on camera calibrated **and** aligned, else `422`). `camera` must be one of `sources` or `422` (prevents a silent-permanent-zero misconfiguration). `sources` is the only way this service learns a camera's live feed URL — it accumulates across calls. Re-posting an existing `name` overwrites it, including mode.

### GET /zoning/zones
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → all zones, each with `mode`, polygon (px or metres), and for world zones, `converted_from` provenance back to what was actually drawn.

### DELETE /zoning/zones/{name}
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → `{"name", "deleted": true}` / `404`.

### WS /zoning/occupancy/stream
**Owner:**
**Type:** WebSocket
**Payload:** optional query `?threshold=N` (default 0), per-connection
**Notes:** Snapshot on connect (`{"type":"snapshot","zones":{...}}`), then `{"type":"update","zone","count","points"}` **only when a zone's count changes** — no heartbeat. Detection runs continuously once ≥1 zone + ≥1 source exist, whether or not anyone's listening. `threshold` gates when you're woken but you're still told when a zone drops back below it.

---

## /face — access control (event-triggered, request/response)

### POST /face/enroll
**Owner:**
**Type:** REST (`multipart/form-data`)
**Payload:** `name` (str) + `image` (one photo, exactly one face)
**Notes:** → `{"name", "embeddings_count"}` (cumulative across every photo ever enrolled for that name). `400` undecodable image, `422` if zero or ≥2 faces found.

### GET /face/faces
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → `[{"name", "embeddings": [[512 floats], ...]}]` — full gallery including raw vectors, for a backend to mirror into its own DB.

### DELETE /face/faces/{name}
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → `{"name", "embeddings_removed"}` / `404`. Removes the person's entire entry.

### POST /face/scan
**Owner:**
**Type:** REST
**Payload:**
```json
{"source": "rtsp://gate-cam", "timeout_seconds": 15}
```
**Notes:** **Blocking** — opens the source, watches until a face appears or timeout, answers on the same request (the caller's HTTP connection stays open). Three outcomes to handle separately: recognised (`name` + `score`), face seen but unrecognised (`name: null`), and `timed_out`/`error` (camera offline) — `error` and `timed_out` are distinct because you react differently to each. `409` if that source is already mid-scan. `score` is cosine similarity, not a probability; match threshold `0.248` (measured on LFW). This is the endpoint a caller uses for an access-control decision on a badge tap — the grant/deny decision itself belongs to whichever service consumes this result, not to this service.

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
**Notes:** **Merges, doesn't replace** — re-posting an id updates just that camera. Detection begins the moment ≥1 source exists.

### GET /{f}/sources
**Owner:** · **Type:** REST · **Payload:** none · **Notes:** → the registry.

### DELETE /{f}/sources/{camera}
**Owner:** · **Type:** REST · **Payload:** none · **Notes:** → `{"camera", "deleted"}` / `404`.

### WS /{f}/alerts/stream
**Owner:**
**Type:** WebSocket
**Payload:** none
**Notes:** Snapshot on connect (`{"type":"snapshot","cameras":{...}}`), then `{"type":"update","camera","detections"}`. **Fires only when a camera's *set of detected classes* changes — not per frame** (confidence jitter alone sends nothing). `bbox` is `[x1,y1,x2,y2]` source-frame pixels. `"detections": []` is the all-clear. A repeated identical alert means the situation genuinely changed and changed back — don't build a UI expecting periodic refreshes.

### /weapon classes
`pistol`, `knife`. Known flicker: pistol↔smartphone label can flip frame-to-frame on the same object — treat presence as reliable over a short window, not on one frame.

### /fire classes
`fire`, `smoke`.

### /emotion classes
`Anger`, `Contempt`, `Disgust`, `Fear`, `Happiness`, `Neutral`, `Sadness`, `Surprise` (one per face). Only trust this on a camera close to the interaction (counter/service desk) — confidence is genuinely low (0.4–0.6) on real candid footage even when working correctly; don't read sub-0.5 as "no signal."

### /wanted classes
`class` is the matched person's **name**. Adds the four routes below.

---

## /wanted — watchlist management (additional routes)

### POST /wanted/watchlist
**Owner:**
**Type:** REST (`multipart/form-data`)
**Payload:** `name` + `image` (exactly one face)
**Notes:** → `{"name", "embeddings_count"}`. Names restricted to `[A-Za-z0-9 ._+-]`, 1–80 chars (`422` otherwise — a `/` would be undeletable via the URL below). Deliberately different route names from `/face/enroll` — the catastrophic failure mode this guards against is enrolling someone into the wrong list, and same-shaped-but-differently-named routes can't be confused for one another the way identical ones could.

### GET /wanted/watchlist
**Owner:**
**Type:** REST
**Payload:** optional query `?include_embeddings=true`
**Notes:** → `[{"name", "embeddings_count"}]`, or with raw 512-d vectors if opted in (deliberately opt-in — dumping a wanted list's biometrics should be a deliberate act).

### DELETE /wanted/watchlist/{name}
**Owner:** · **Type:** REST · **Payload:** none · **Notes:** → `{"name", "embeddings_removed"}` / `404`.

### GET /wanted/threshold
**Owner:**
**Type:** REST
**Payload:** none
**Notes:** → `{"threshold", "min_face_px", "startup_default", "floor": 0.25, "watchlist_size", "embeddings_total", "applies_within_seconds"}`.

### PUT /wanted/threshold
**Owner:**
**Type:** REST
**Payload:**
```json
{"threshold": 0.58}
```
**Notes:** Both fields optional, ≥1 required. Takes effect next detection cycle, **not persisted** (restart reverts to measured default — re-apply on boot for a standing value). `422` below the `0.25` floor (below the access-control-validated `0.248`, open-set matching false-alarms constantly). Lowering below the measured default succeeds but returns a `warnings` entry.

### Wanted alert payload (inside the common `/wanted/alerts/stream` shape)
```json
{"class": "MAROUANE-B-2024-114", "confidence": 0.612, "bbox": [412.0,88.0,501.0,205.0],
 "det_score": 0.881, "face_px": 94, "snapshot": "<base64 jpeg>"}
```
**Notes:** `confidence` is cosine similarity in `[-1,1]`, not a probability — don't render as "% confident." `snapshot` (base64 JPEG, ~20KB, nothing written to disk) attaches once, to the highest-confidence detection. Hysteresis: confirm cycles before alerting, hold cycles before all-clear — held entries carry `"held": true`. **Unknown faces are never emitted anywhere** — an innocent passer-by's embedding exists only until garbage-collected. A match is evidence for a human to review, never an automatic action.
