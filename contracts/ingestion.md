# Ingestion Contract (internal)

Contract between the backend and the hardware/IoT layer. This document defines
the payloads, topics and authentication required by the SmartAgency backend.

The owner of the producing subsystem maintains the corresponding contract
entry. Any change that removes an endpoint or changes/removes an existing field
must prefix the PR title with `BREAKING:` and be announced in `#api-contract`.

The checklist for Basma is included at the end of this document.

---

## Index

| Endpoint or topic | Direction | Protocol | Subsystem |
|---|---|---|---|
| `POST /internal/tickets/walk-in` | Hardware → Backend | HTTP | Ticket kiosk |
| `GET /internal/tickets/kiosk-config` | Hardware → Backend | HTTP | Ticket kiosk |
| `GET /internal/tickets/ticket-template` | Hardware → Backend | HTTP | Ticket kiosk (print layout) |
| `POST /internal/attendance/check-rfid` | Hardware → Backend | HTTP | RFID |
| `POST /internal/access/door-access` | Hardware → Backend | HTTP | Zone-access door (RFID + servo) |
| `POST /internal/tickets/call-next` | Hardware → Backend | HTTP | Queue counter display (7-segment) |
| `agency/{agency_id}/device/{device_id}/ticket-called` | Backend → Hardware | MQTT | Queue counter display (7-segment) |
| `agency/{agency_id}/device/{device_id}/sensor` | Hardware → Backend | MQTT | DHT11, MQ2 (as `gas_co`) |
| `agency/{agency_id}/device/{device_id}/alert` | Backend → Hardware | MQTT | Buzzer |
| `agency/{agency_id}/device/{device_id}/climate` | Backend → Hardware | MQTT | Climate actuator (fan + relay) |

---

## 1. Device identity and authentication

Every hardware device must first be registered by an authenticated backend
user through:

```text
POST /api/devices/agencies/{agency_id}
```

The backend returns a `device_key` once. The key must be stored securely in the
ESP32 and must not be committed to GitHub or shared in Discord.

The hardware `device_id` must be exactly the registered `mqtt_client_id`.
It is not the internal database UUID of the device.

Every internal REST endpoint requires:

```http
Content-Type: application/json
X-Device-Key: DEVICE_SECRET_KEY
```

MQTT authentication uses the broker credentials configured by the backend and
the broker. The REST `device_key` is not an MQTT password.

---

## 2. Hardware → Backend: REST ingestion

### POST /internal/tickets/walk-in

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
Content-Type: application/json
X-Device-Key: DEVICE_SECRET_KEY
```

**Request body:**

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "ticket-kiosk-01",
  "service_id": "SERVICE_UUID",
  "visitor": {
    "full_name": "Visiteur borne",
    "phone": null,
    "identity_reference": null
  },
  "timestamp": "2026-08-25T14:32:00Z"
}
```

**Response body:**

```json
{
  "ticket_id": "TICKET_UUID",
  "ticket_number": "20260825-VIR-001",
  "service_id": "SERVICE_UUID",
  "service_type": "Virement et consultation",
  "status": "WAITING"
}
```

**Success status:** `201 Created`
**Notes:**

- `service_id` is the preferred way to select the service.
- The selected service must be active and belong to `agency_id`.
- `service_type` may be used as a temporary legacy fallback instead of
  `service_id`; it must match the service code or name exactly, ignoring case.
- `visitor` is optional. If omitted, the backend creates a visitor named
  `Visiteur borne`.
- `timestamp` is optional. If omitted, the backend uses the current UTC time.
- The new ticket always starts in `WAITING` status.
- `401` means the `X-Device-Key` is missing or invalid.
- `404` means the device or service does not exist.
- `409` means the service is inactive.
- `422` means the service belongs to another agency or the payload is invalid.

### GET /internal/tickets/kiosk-config

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
X-Device-Key: DEVICE_SECRET_KEY
```

**Query parameters:**

```text
agency_id=AGENCY_UUID
device_id=ticket-kiosk-01
```

**Response body:**

```json
{
  "services": [
    { "service_id": "SERVICE_UUID_1", "code": "VIR", "name": "Virement et consultation", "counter_id": "COUNTER_UUID_1" },
    { "service_id": "SERVICE_UUID_2", "code": "OUV", "name": "Ouverture de compte", "counter_id": "COUNTER_UUID_2" }
  ],
  "messages": {
    "error_line1": "Erreur reseau",
    "error_line2": "Reessayez",
    "no_service_line1": "Aucun service",
    "no_service_line2": "disponible"
  }
}
```

**Success status:** `200 OK`
**Notes:**

- Every `is_active` service for `agency_id`, ordered by `code` -- same
  `services` table as `GET /api/agencies/{agency_id}/services`.
- The Uno cycles through all entries returned, not limited to 2.
- Send the selected entry's `service_id` (not `service_type`) to
  `POST /internal/tickets/walk-in`.
- `counter_id` is the `Counter` currently assigned to this service (see
  `PUT /api/counters/{counter_id}/service`) -- used as `counter_id` in
  `POST /internal/tickets/call-next` below, so the firmware never needs a
  counter UUID hardcoded in `secrets.h`. `null` if no counter is assigned
  yet. Nothing in the schema guarantees exactly one counter per service; if
  more than one is assigned, which one is returned here is a backend
  decision, not a hardware one.
- Empty `services`: show "no service available", disable confirmation.
- `name` may exceed 16 columns; Uno truncates for display only.
- `messages`: 4 LCD lines, free text on `Device.kiosk_messages` (JSON),
  default to the values above when unset.
- `401` invalid/missing key. `404` unknown device.
- Poll periodically, not just at boot.

### GET /internal/tickets/ticket-template

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
X-Device-Key: DEVICE_SECRET_KEY
```

**Query parameters:**

```text
agency_id=AGENCY_UUID
device_id=ticket-kiosk-01
```

**Response body:**

```json
{
  "template": [
    { "type": "text", "content": "Bienvenue chez nous" },
    { "type": "agency_name", "content": "Agence Casablanca" },
    { "type": "ticket_number" },
    { "type": "service_name" },
    { "type": "date" },
    { "type": "qrcode", "content": "https://..." },
    { "type": "image", "data": "BASE64_MONOCHROME_BITMAP", "rows": 120 },
    { "type": "spacing", "lines": 2 }
  ]
}
```

**Success status:** `200 OK`
**Notes:**

- Ordered list of print blocks the ESP32 renders top to bottom on the
  Bluetooth thermal printer, one entry per `println`/ESC-POS command --
  `Agency.ticket_template` (JSON), one template **per agency**, not per
  device or per kiosk.
- Block types, by **who resolves the value**:
  - `text`: static line, `content` printed as-is.
  - `agency_name`: backend-resolved -- `content` is `Agency.name` at the
    time this endpoint is called.
  - `ticket_number` / `service_name` / `date`: firmware-resolved, no
    `content` sent by the backend (`date` is the print timestamp, not the
    template-fetch timestamp).
  - `qrcode`: `content` is the literal text/URL to encode, rendered via the
    printer's own ESC/POS QR command (`GS ( k`) -- not sent as an image.
  - `image`: `data` is a monochrome bitmap already converted server-side
    (384px wide / 48 bytes per row, 1-bit, dithered), base64-encoded, sent
    via the ESC/POS raster command (`GS v 0`). `rows` is the bitmap height
    in pixels/dots. The ESP32 does no image decoding or resizing -- the
    backend owns the upload/resize/dither step.
  - `spacing`: `lines` blank lines.
- Default when `Agency.ticket_template` is unset: a single `text` block
  ("SmartAgency") + `ticket_number` + `service_name` + 3 `spacing` lines --
  matches today's hardcoded firmware output.
- Separate endpoint from `kiosk-config`: a template can carry an image
  (heavier, rarely changes) while `kiosk-config` is polled often for the
  live service list. Poll this one rarely -- at boot plus e.g. every
  10-15 min -- never on every ticket printed.
- `401` invalid/missing key. `404` unknown device.

### POST /internal/attendance/check-rfid

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
Content-Type: application/json
X-Device-Key: DEVICE_SECRET_KEY
```

**Request body:**

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "rfid-gate-01",
  "employee_rfid": "A1B2C3D4",
  "timestamp": "2026-08-25T09:15:00Z"
}
```

The hardware never sends `event` -- it only reads a raw UID and forwards it.
The backend decides `check_in` vs `check_out` itself: an employee with no
open attendance (no `check_out` recorded yet) checks in, an employee with one
checks out.

**Response when the event is accepted:**

```json
{
  "valid": true,
  "employee_name": "Ahmed Benali",
  "event": "check_in",
  "message": null
}
```

**Response when the card or attendance event is invalid:**

```json
{
  "valid": false,
  "employee_name": null,
  "event": null,
  "message": "Carte RFID ou employe introuvable"
}
```

**Success status:** `200 OK`
**Notes:**

- An unknown card returns `200` with `valid: false`; this is a normal business
  response, not a network error.
- The employee must be active and belong to the agency in the request.
- The backend derives `check_in`/`check_out` from whether the employee
  already has an open attendance -- the hardware never sends or chooses it.
- A missing or invalid device key returns `401`.
- An unknown device returns `404`.

### POST /internal/access/door-access

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
Content-Type: application/json
X-Device-Key: DEVICE_SECRET_KEY
```

**Request body:**

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "access-sensors-1",
  "employee_rfid": "A1B2C3D4",
  "timestamp": "2026-09-10T09:15:00Z"
}
```

**Response when the badge is authorized:**

```json
{
  "authorized": true,
  "employee_name": "Ahmed Benali",
  "message": null
}
```

**Response when the badge is unknown or not authorized for this door:**

```json
{
  "authorized": false,
  "employee_name": null,
  "message": "Carte RFID inconnue ou acces refuse"
}
```

**Success status:** `200 OK`
**Notes:**

- Guards the counter/guichet zone-access door, distinct from the main
  entrance attendance gate (`rfid-gate-01` / `check-rfid`). The **same
  physical RFID badge** is used for both readers -- "carte" vs "tag" is
  purely a visual/physical distinction, both are read by the identical
  MFRC522 flow.
- No `event` field, unlike `check-rfid` -- this endpoint never creates an
  attendance record, it only authorizes (or refuses) opening the door.
- An unknown card, or a known employee without door access, both return
  `200` with `authorized: false`; this is a normal business response, not a
  network error (same convention as `check-rfid`'s `valid: false`).
- Authorization is based on a new `role` field on `Employee`: `STANDARD`
  (default, no door access) or `AUTHORIZED` (door access granted). The
  hardware never evaluates this itself -- it only reads the response.
- A missing or invalid device key returns `401`.
- An unknown device returns `404`.

---

## 3. Hardware ↔ Backend: Queue counter display (7-segment)

A TM1637 4-digit display on the same ESP32 as the ticket kiosk shows the
last-called ticket per service, formatted `A*C*` (e.g. `A5C2` -- the
trailing digit of each service's last-called `ticket_number`).

**Design principle:** the display never computes locally. It only ever
renders what a `ticket-called` MQTT message tells it, no matter what
triggered that message.

Two triggers publish the same `ticket-called` message, via the same "call
the next ticket" logic and the same `publish_ticket_called()`:

- **Frontend** (already implemented): `POST /api/tickets/{ticket_id}/call`,
  see `contracts/api.md`.
- **Button** (new, this section): `POST /internal/tickets/call-next` below.

So the display can never diverge between the two, and self-corrects on the
next message after any restart -- no boot-time fetch is needed.

### POST /internal/tickets/call-next

**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Headers:**

```http
Content-Type: application/json
X-Device-Key: DEVICE_SECRET_KEY
```

**Request body:**

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "queue-display-01",
  "service_id": "SERVICE_UUID",
  "counter_id": "COUNTER_UUID"
}
```

**Response body:**

```json
{
  "called": true,
  "ticket_id": "TICKET_UUID",
  "ticket_number": "20260827-SVC-A-006",
  "service_code": "SVC-A"
}
```

**Response body when the service's queue is empty:**

```json
{
  "called": false,
  "ticket_id": null,
  "ticket_number": null,
  "service_code": "SVC-A"
}
```

**Success status:** `200 OK`
**Notes:**

- `counter_id` comes from the matching entry's `counter_id` in
  `GET /internal/tickets/kiosk-config` (above), not hardcoded in the
  ESP32's secrets -- must be an open counter assigned to `service_id`,
  matching its `point_type`.
- Same logic as `POST /api/tickets/{ticket_id}/call`: picks the oldest
  `WAITING` ticket for `service_id`, one shared implementation, not a
  second divergent one.
- `called: false` (`200 OK`): queue empty, normal response, no auto-retry.
- Response used for success/failure only -- display updates via
  `ticket-called` below, never from this response.
- `401` invalid/missing key. `404` unknown device/service/counter.
  `409` counter closed. `422` counter/service/agency mismatch.

### MQTT agency/{agency_id}/device/{device_id}/ticket-called

**Owner:** Backend
**Type:** MQTT command
**Direction:** Backend → Hardware
**Response:** No response is expected.
**Status:** Already implemented (`c52dc51`) -- no new backend work.

The hardware must subscribe to:

```text
agency/{agency_id}/device/{device_id}/ticket-called
```

Published on every successful call (frontend or this device's own button)
to every `QUEUE_DISPLAY` device in the agency, including the one that
triggered it.

**Payload:**

```json
{
  "service_code": "SVC-A",
  "ticket_number": "20260827-SVC-A-005"
}
```

**Notes:**

- `service_code` identifies which digit (`A` or `C`) to update.
- The display extracts the trailing sequence from `ticket_number` and shows
  its last digit (`005` becomes `5`) for that service.
- A failed ticket call (from either pipeline) does not publish a message.
- Messages use normal MQTT QoS and are not retried by the backend.

### Queue counter display behavior

1. On button press: send `POST /internal/tickets/call-next` and block until
   a response arrives -- do not touch the display from this call, in either
   the success or the failure case.
2. Regardless of which pipeline triggered it, the display only updates on a
   `ticket-called` MQTT message: parse the trailing digit of `ticket_number`
   and set the matching service's digit to it.
3. On a failed button press (`called: false`, or `401`/`404`/`409`/`422`),
   leave the digit unchanged; log the outcome, do not retry beyond the
   connection-refused case noted above.
4. Never fetch or poll for the current ticket number on boot -- the display
   simply shows its last rendered state (or `A0C0` after a fresh flash)
   until the first `ticket-called` message arrives.

---

## 4. Hardware → Backend: MQTT sensor ingestion

### MQTT agency/{agency_id}/device/{device_id}/sensor

**Owner:** Basma (hardware)
**Type:** MQTT fire-and-forget
**Direction:** Hardware → Backend
**Response:** No MQTT response is expected.

The backend subscribes to:

```text
agency/+/device/+/sensor
```

The `device_id` in the topic must match a registered device's
`mqtt_client_id` in the same agency.

**DHT11 payload:**

```json
{
  "readings": [
    {
      "sensor_type": "temperature",
      "value": 24.5,
      "unit": "C"
    },
    {
      "sensor_type": "humidity",
      "value": 61.2,
      "unit": "%"
    }
  ],
  "timestamp": "2026-08-25T10:00:00Z"
}
```

**MQ2 payload (gas_co):**

```json
{
  "readings": [
    {
      "sensor_type": "gas_co",
      "value": 12.4,
      "unit": "ppm"
    }
  ],
  "timestamp": "2026-08-25T10:00:05Z"
}
```

Supported sensor type names are:

```text
temperature
humidity
gas_co
```

**Notes:**

- `readings` must contain at least one reading.
- `value` must be numeric.
- `timestamp` must be an ISO-8601 UTC date-time.
- The backend stores each reading in `sensor_readings`.
- An unregistered device message is rejected and logged by the backend.

---

## 5. Backend → Hardware: MQTT alert command

### MQTT agency/{agency_id}/device/{device_id}/alert

**Owner:** Backend
**Type:** MQTT command
**Direction:** Backend → Hardware
**Response:** No response is expected.

The hardware must subscribe to:

```text
agency/{agency_id}/device/{device_id}/alert
```

**Active alert:**

```json
{
  "alert_type": "gas_co",
  "active": true,
  "severity": "CRITICAL"
}
```

**Resolved alert:**

```json
{
  "alert_type": "gas_co",
  "active": false,
  "severity": "LOW"
}
```

Allowed severity values:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

**Threshold behavior:**

- `warning_max` exceeded → alert severity `HIGH`.
- `critical_max` exceeded → alert severity `CRITICAL`.
- Value returns below the configured limits → `active: false` and severity
  `LOW`.

The ESP32 must activate the buzzer/LED when `active` is `true` and deactivate
it when `active` is `false`.

---

## 6. Backend → Hardware: MQTT climate command

### MQTT agency/{agency_id}/device/{device_id}/climate

**Owner:** Backend
**Type:** MQTT command
**Direction:** Backend → Hardware
**Response:** No response is expected.

The hardware must subscribe to:

```text
agency/{agency_id}/device/{device_id}/climate
```

**Activate climate actuator:**

```json
{
  "active": true
}
```

**Deactivate climate actuator:**

```json
{
  "active": false
}
```

The climate state follows the configured `warning_max` threshold for the
`temperature` sensor. The backend republishes the current state when it
receives a temperature reading so the actuator can recover after a restart.

---

## 7. Basma hardware integration checklist

### Before connecting the ESP32

1. Register each device in the backend using
   `POST /api/devices/agencies/{agency_id}`.
2. Save the returned `device_key` in the ESP32 secure configuration.
3. Use the returned `mqtt_client_id` as `device_id` in all requests and MQTT
   topics.
4. Do not use the device database UUID as the MQTT `device_id`.
5. Configure the MQTT broker host, port, username and password.
6. Configure the agency UUID and service UUID in the device configuration.

### Ticket kiosk

See `POST /internal/tickets/walk-in`, `GET /internal/tickets/kiosk-config`
and `GET /internal/tickets/ticket-template` above for full request/response
shapes and behavior.

1. Send `X-Device-Key` on every request; treat `401`/`404`/`422` as
   request/configuration errors and log them.
2. `walk-in`: prefer `service_id` over `service_type`; read `ticket_number`
   from the `201` response and display it.
3. `kiosk-config`: poll periodically, not just at boot; use `counter_id`
   per service for the queue-display buttons, not a hardcoded value.
4. `ticket-template`: poll rarely (boot + ~10-15 min), never per ticket.

### RFID reader (attendance)

See `POST /internal/attendance/check-rfid` above.

1. Send the RFID UID exactly as scanned, no `event` field -- the backend
   decides `check_in`/`check_out`.
2. Treat `200` with `valid: false` as a normal rejected-card response, not
   an error; log the returned `message` without retrying indefinitely.

### Queue counter display (7-segment)

See `POST /internal/tickets/call-next` and the `ticket-called` MQTT topic
above for the full behavior (button press vs. display update are
deliberately decoupled).

1. Register with `device_type: "QUEUE_DISPLAY"` exactly.
2. Read `counter_id` per service from `kiosk-config` -- never hardcode it.
3. On a button press, send `call-next` only to know success/failure; never
   update the display from its response.
4. The digit only ever changes on a `ticket-called` MQTT message; never
   poll for the current ticket number on boot.

### DHT11 and MQ2 (device `access-sensors-1`)

See the `sensor`/`alert`/`climate` MQTT topics above. One physical device
handles both sensor types and both command topics.

1. Publish temperature + humidity every 10s, `gas_co` every 5s -- exact
   sensor type names, ISO-8601 UTC timestamps.
2. Subscribe to `/alert` and `/climate`; apply `active` immediately.
3. Firmware-local safety timeout (not part of the contract): stop the
   buzzer/fan if no message arrives on its topic for 5 minutes.

### Zone-access door (device `access-sensors-1`, same physical ESP32)

See `POST /internal/access/door-access` above.

1. On every badge scan, send `door-access` with `employee_rfid`, no
   `event` field.
2. `authorized: true` -> open the servo (90°), hold ~3s, close;
   `false` -> leave it closed.
3. Never call `check-rfid` for this door, and never call `door-access` for
   the main entrance gate -- they must stay separate.

### Threshold calibration

Configure thresholds through the backend before testing alerts:

```text
PUT /api/devices/{device_id}/thresholds/temperature
PUT /api/devices/{device_id}/thresholds/humidity
PUT /api/devices/{device_id}/thresholds/gas_co
```

Example gas (MQ2, `gas_co`) threshold:

```json
{
  "unit": "ppm",
  "warning_max": 10,
  "critical_max": 20,
  "is_active": true
}
```

The values above are examples only. Basma must calibrate them according to the
real sensors and the intended safety limits.

### Security and reliability requirements

- Never commit `device_key`, MQTT passwords or Wi-Fi passwords to GitHub.
- Use HTTPS for REST ingestion outside the local network.
- Use authenticated MQTT and TLS in production.
- Add a timeout and bounded retry policy to HTTP requests.
- Do not create duplicate tickets when retrying after an unknown network
  failure; first verify whether the backend already returned a ticket.
- Log the HTTP status and MQTT topic for each failed integration test.
