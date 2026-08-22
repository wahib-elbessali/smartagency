# Ingestion Contract (internal)

Endpoints the backend exposes to receive events from the IoT/AI layer. Owned by whoever builds the piece producing the event — not a dedicated contract-owner role.

Any change that alters or removes an existing field/endpoint (not just adds a new optional one): prefix the PR title `BREAKING:` and flag it in `#api-contract`, don't just merge it as a routine notice.

Implementation notes and hardware-side TODOs live in `ingestionDetails.md`, kept separate so this file stays a clean reference of shapes only.

Entry template:

```
### METHOD /path
**Owner:**
**Type:** REST internal ingestion
**Payload:**
{
}
```

---

## Index

| Endpoint | Direction | Protocol | Subsystem |
|---|---|---|---|
| `POST /internal/tickets/walk-in` | hardware → backend | HTTP | Ticket kiosk |
| `POST /internal/attendance/check-rfid` | hardware → backend | HTTP | RFID |
| `MQTT .../sensor` | hardware → backend | MQTT | DHT22, MQ-7 |
| `MQTT .../alert` | backend → hardware | MQTT | MQ-7 (buzzer/LED) |
| `MQTT .../climate` | backend → hardware | MQTT | DHT22 (stepper "clim") |

Door lock subsystem (NEMA17 + A4988 ×2) not designed yet — deliberately left out for now.

---

## Hardware → Backend

### POST /internal/tickets/walk-in
**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Payload:**
```
{
  "agency_id": "AGENCY_UUID",
  "device_id": "ticket-kiosk-01",
  "service_type": "Service A",
  "timestamp": "2026-08-21T14:32:00Z"
}
```
**Response:**
```
{
  "ticket_number": "20260821-001",
  "service_type": "Service A"
}
```

### POST /internal/attendance/check-rfid
**Owner:** Basma (hardware)
**Type:** REST internal ingestion
**Payload:**
```
{
  "agency_id": "AGENCY_UUID",
  "device_id": "rfid-gate-01",
  "employee_rfid": "A1B2C3D4",
  "event": "check_in" | "check_out",
  "timestamp": "2026-08-22T09:15:00Z"
}
```
**Response (always HTTP 200):**
```
{
  "valid": true,
  "employee_name": "string",
  "event": "check_in" | "check_out"
}
```
or, if the card is unknown:
```
{
  "valid": false,
  "message": "string"
}
```

### MQTT agency/{agency_id}/device/{device_id}/sensor
**Owner:** Basma (hardware)
**Type:** MQTT (fire-and-forget, no response)
**Payload (DHT22, device_id = dht22 unit):**
```
{
  "readings": [
    { "sensor_type": "temperature", "value": 24.5, "unit": "C" },
    { "sensor_type": "humidity", "value": 61.2, "unit": "%" }
  ],
  "timestamp": "2026-08-22T10:00:00Z"
}
```
**Payload (MQ-7, device_id = mq7 unit):**
```
{
  "readings": [
    { "sensor_type": "gas_co", "value": 12.4, "unit": "ppm" }
  ],
  "timestamp": "2026-08-22T10:00:05Z"
}
```

---

## Backend → Hardware

First flows in this project going this direction — the device subscribes, the backend publishes. No response is expected back on either of these.

### MQTT agency/{agency_id}/device/{device_id}/alert
**Owner:** Basma (hardware)
**Type:** MQTT, backend → device
**Payload:**
```
{
  "alert_type": "gas_co",
  "active": true,
  "severity": "CRITICAL"
}
```

### MQTT agency/{agency_id}/device/{device_id}/climate
**Owner:** Basma (hardware)
**Type:** MQTT, backend → device
**Payload:**
```
{
  "active": true
}
```

