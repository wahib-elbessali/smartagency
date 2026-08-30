# Public API Contract (egress)

REST and WebSocket surface consumed by the frontend. Each endpoint owner is
responsible for keeping its contract entry synchronized with the backend.

Any change that removes an endpoint or changes/removes an existing field must
prefix the PR title with `BREAKING:` and be announced in `#api-contract`.

## Conventions

- Every endpoint requires a valid Bearer access token unless marked **Public**.
- A missing or invalid access token returns `401 Unauthorized`.
- UUID values are represented by placeholders such as `AGENCY_UUID`.
- Date-time values use ISO-8601 UTC format.
- Roles and enum values are returned in uppercase.
- Passwords and password hashes are never returned.
- Request bodies list only the fields accepted by the endpoint.
- Fields not listed in a partial update request are left unchanged.

## Roles

`ADMIN`, `MANAGER`, `AGENT`, `SECURITY`, `TECHNICIAN`

---

## 1. Authentication

### POST /api/auth/register

**Owner:** Backend
**Type:** REST
**Roles:** Public
**Request body:**

```json
{
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "password": "SecurePass123",
  "agency_id": null
}
```

**Response body:**

```json
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "AGENT",
  "agency_id": null,
  "is_active": true
}
```

**Success status:** `201 Created`
**Notes:** Public registration always creates an `AGENT`. `agency_id` is
optional. Errors: `404` if the agency does not exist, `409` if the email is
already registered, and `422` for invalid name, email or password.

### POST /api/auth/login

**Owner:** Backend
**Type:** REST
**Roles:** Public
**Request body:**

```json
{
  "email": "admin@test.com",
  "password": "SecurePass123"
}
```

**Response body:**

```json
{
  "access_token": "JWT_ACCESS_TOKEN",
  "refresh_token": "JWT_REFRESH_TOKEN",
  "token_type": "bearer",
  "user": {
    "id": "USER_UUID",
    "full_name": "Admin Test",
    "email": "admin@test.com",
    "role": "ADMIN",
    "agency_id": null,
    "is_active": true
  }
}
```

**Success status:** `200 OK`
**Notes:** Returns `401` for an unknown email or incorrect password and `403`
for a disabled account.

### GET /api/auth/me

**Owner:** Backend
**Type:** REST
**Roles:** Any authenticated user
**Response body:**

```json
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "MANAGER",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
```

**Success status:** `200 OK`

### POST /api/auth/refresh

**Owner:** Backend
**Type:** REST
**Roles:** Public with a valid refresh token
**Request body:**

```json
{
  "refresh_token": "JWT_REFRESH_TOKEN"
}
```

**Response body:** Same shape as `POST /api/auth/login`.
**Success status:** `200 OK`
**Notes:** Returns `401` if the refresh token is missing, invalid, expired or
belongs to a disabled/non-existent user.

---

## 2. Agencies

### GET /api/agencies

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:**

```json
[
  {
    "id": "AGENCY_UUID",
    "name": "Agence Casablanca",
    "address": "Casablanca",
    "phone": "0522000000",
    "opening_time": "08:30:00",
    "closing_time": "16:30:00",
    "is_active": true,
    "zones": [],
    "counters": [],
    "employees_count": 4,
    "devices_count": 2,
    "cameras_count": 3
  }
]
```

**Success status:** `200 OK`
**Notes:** `ADMIN` sees all agencies. `MANAGER` sees only their own agency.

### POST /api/agencies

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "name": "Agence Casablanca",
  "address": "Casablanca",
  "phone": "0522000000",
  "opening_time": "08:30:00",
  "closing_time": "16:30:00",
  "zones": [
    {
      "name": "Accueil",
      "zone_type": "PUBLIC",
      "is_private": false
    }
  ],
  "counters": [
    {
      "number": 1,
      "name": "Guichet 1",
      "point_type": "COUNTER",
      "is_open": true
    }
  ]
}
```

**Response body:** Agency object with generated IDs for the agency, zones and
counters.
**Success status:** `201 Created`
**Notes:** `name` is required. Counter numbers must be unique within the
agency.

### GET /api/agencies/{agency_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** One agency object.
**Success status:** `200 OK`
**Notes:** `MANAGER` can access only their own agency. Returns `404` if the
agency does not exist.

### PUT /api/agencies/{agency_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER` for their own agency
**Request body:**

```json
{
  "name": "Agence Casablanca Updated",
  "address": "New address",
  "phone": "0522000000",
  "opening_time": "08:30:00",
  "closing_time": "17:00:00",
  "is_active": true
}
```

**Response body:** Updated agency object.
**Success status:** `200 OK`

### DELETE /api/agencies/{agency_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Response body:** Empty
**Success status:** `204 No Content`
**Notes:** Returns `404` if the agency does not exist.

---

## 3. Services and service points

### GET /api/agencies/{agency_id}/services

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:**

```json
[
  {
    "id": "SERVICE_UUID",
    "agency_id": "AGENCY_UUID",
    "code": "VIR",
    "name": "Virement et consultation",
    "description": "Virements et consultation de compte",
    "point_type": "COUNTER",
    "min_points": 2,
    "is_active": true
  }
]
```

**Success status:** `200 OK`

### POST /api/agencies/{agency_id}/services

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Request body:**

```json
{
  "code": "VIR",
  "name": "Virement et consultation",
  "description": "Virements et consultation de compte",
  "point_type": "COUNTER",
  "min_points": 2,
  "is_active": true
}
```

**Response body:** Service object with generated `id`.
**Success status:** `201 Created`
**Notes:** `code` is unique per agency. `point_type` is `COUNTER` or `OFFICE`.

### GET /api/services/{service_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:** Service object.
**Success status:** `200 OK`

### PUT /api/services/{service_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Request body:**

```json
{
  "name": "Virement et consultation de compte",
  "min_points": 2,
  "is_active": true
}
```

**Response body:** Updated service object.
**Success status:** `200 OK`
**Notes:** A service point already assigned to the service prevents changing
its `point_type`.

### DELETE /api/services/{service_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** Empty
**Success status:** `204 No Content`
**Notes:** Deletion is refused while points or tickets still reference the
service.

### GET /api/services/{service_id}/points

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:**

```json
[
  {
    "id": "COUNTER_UUID",
    "agency_id": "AGENCY_UUID",
    "service_id": "SERVICE_UUID",
    "number": 1,
    "name": "Guichet principal",
    "point_type": "COUNTER",
    "is_open": true
  }
]
```

**Success status:** `200 OK`

### PATCH /api/counters/{counter_id}/service

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Request body:**

```json
{
  "service_id": "SERVICE_UUID"
}
```

**Response body:** Updated service point object.
**Success status:** `200 OK`
**Notes:** The service and point must belong to the same agency. Send
`{"service_id": null}` to remove the assignment.

---

## 4. Employees

### GET /api/employees

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:**

```json
[
  {
    "id": "EMPLOYEE_UUID",
    "agency_id": "AGENCY_UUID",
    "first_name": "Ahmed",
    "last_name": "Benali",
    "email": "ahmed@agency.com",
    "phone": "0612345678",
    "position": "Agent d'accueil",
    "rfid_uid": "RFID-001",
    "status": "ACTIVE",
    "hire_date": "2026-08-01",
    "is_active": true
  }
]
```

**Success status:** `200 OK`
**Notes:** `ADMIN` sees all employees. `MANAGER` sees only their own agency.

### POST /api/employees

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Request body:**

```json
{
  "first_name": "Ahmed",
  "last_name": "Benali",
  "email": "ahmed@agency.com",
  "phone": "0612345678",
  "position": "Agent d'accueil",
  "agency_id": "AGENCY_UUID",
  "rfid_uid": "RFID-001",
  "status": "ACTIVE",
  "hire_date": "2026-08-01"
}
```

**Response body:** Employee object.
**Success status:** `201 Created`
**Notes:** `ADMIN` must provide `agency_id`. `MANAGER` employees are always
created in the manager's agency. `email` and `rfid_uid` must be unique.

### GET /api/employees/{employee_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** Employee object.
**Success status:** `200 OK`

### PUT /api/employees/{employee_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Request body:**

```json
{
  "email": "ahmed.updated@agency.com",
  "position": "Supervisor",
  "status": "ACTIVE"
}
```

**Response body:** Updated employee object.
**Success status:** `200 OK`
**Notes:** A `MANAGER` cannot move an employee to another agency.

### DELETE /api/employees/{employee_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** Empty
**Success status:** `204 No Content`

---

## 5. Users, roles and permissions

All endpoints in this section require the `ADMIN` role.

### GET /api/users

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Response body:**

```json
[
  {
    "id": "USER_UUID",
    "full_name": "Sara Security",
    "email": "sara@agency.com",
    "role": "SECURITY",
    "agency_id": "AGENCY_UUID",
    "employee_id": "EMPLOYEE_UUID",
    "is_active": true,
    "employee": {
      "id": "EMPLOYEE_UUID",
      "first_name": "Sara",
      "last_name": "Security",
      "agency_id": "AGENCY_UUID",
      "rfid_uid": "RFID-SEC-001"
    }
  }
]
```

**Success status:** `200 OK`

### POST /api/users

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "full_name": "Sara Security",
  "email": "sara@agency.com",
  "password": "SecurePass123",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID"
}
```

**Response body:** User object.
**Success status:** `201 Created`
**Notes:** `ADMIN` must have `agency_id: null`. All other roles require an
existing agency. `employee_id` is optional and links one employee to one user.

### GET /api/users/{user_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Response body:** User object.
**Success status:** `200 OK`

### PUT /api/users/{user_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "full_name": "Sara Security Updated",
  "email": "sara.updated@agency.com",
  "password": "NewSecurePass123",
  "is_active": true,
  "employee_id": "EMPLOYEE_UUID"
}
```

**Response body:** Updated user object.
**Success status:** `200 OK`
**Notes:** This route does not change `role` or `agency_id`.

### PATCH /api/users/{user_id}/role

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "role": "TECHNICIAN"
}
```

**Response body:** Updated user object.
**Success status:** `200 OK`
**Notes:** Converting to `ADMIN` clears `agency_id`. To change role and agency
at the same time, use `/access`.

### PATCH /api/users/{user_id}/agency

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "agency_id": "AGENCY_UUID"
}
```

**Response body:** Updated user object.
**Success status:** `200 OK`
**Notes:** The agency must be compatible with the user's current role.

### PATCH /api/users/{user_id}/access

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Request body:**

```json
{
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID"
}
```

**Response body:**

```json
{
  "id": "USER_UUID",
  "full_name": "Sara Security",
  "email": "sara@agency.com",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "is_active": true,
  "employee": null
}
```

**Success status:** `200 OK`
**Notes:** Updates role and agency atomically using the resulting state. An
`ADMIN` must have `agency_id: null`; every other role requires an existing
agency. A linked employee follows the new agency when one is provided.

### DELETE /api/users/{user_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`
**Response body:** Empty
**Success status:** `204 No Content`
**Notes:** An `ADMIN` cannot delete their own account. Returns `400` for that
case and `404` if the user does not exist.

---

## 6. RFID attendance

### POST /api/attendance/check-in

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Request body:**

```json
{
  "employee_rfid": "RFID-001",
  "timestamp": "2026-08-25T08:30:00Z",
  "agency_id": null
}
```

**Response body:**

```json
{
  "id": "ATTENDANCE_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-25T08:30:00Z",
  "check_out": null,
  "method": "RFID"
}
```

**Success status:** `200 OK`
**Notes:** The employee is identified by `employee_rfid`. `timestamp` and
`agency_id` are optional. A `MANAGER` or `SECURITY` user is restricted to their
own agency.

### POST /api/attendance/check-out

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Request body:** Same shape as check-in.
**Response body:** Attendance object with a non-null `check_out`.
**Success status:** `200 OK`
**Notes:** Returns `409` if the employee has no open attendance record.

### GET /api/attendance/today

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Response body:** Array of attendance objects.
**Success status:** `200 OK`
**Notes:** `ADMIN` sees all agencies. `MANAGER` and `SECURITY` see their own
agency only.

### GET /api/attendance/employee/{employee_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Response body:** Array of attendance objects ordered from newest to oldest.
**Success status:** `200 OK`

### WS /ws/attendance?token=JWT_ACCESS_TOKEN

**Owner:** Backend
**Type:** WebSocket
**Roles:** Any authenticated user
**Message body:**

```json
{
  "id": "ATTENDANCE_UUID",
  "type": "attendance_updated",
  "event": "check_in",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-25T08:30:00Z",
  "check_out": null,
  "method": "RFID"
}
```

**Notes:** The `id` field is always present. MQTT-triggered messages also
include `device_id`; REST-triggered messages do not.

---

## 7. Visitors

### POST /api/visitors

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`, `SECURITY`
**Request body:**

```json
{
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "agency_id": "AGENCY_UUID"
}
```

**Response body:** Visitor object.
**Success status:** `201 Created`
**Notes:** `ADMIN` must provide an agency. For other roles, the visitor is
created in the caller's agency.

### GET /api/visitors

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`, `SECURITY`
**Response body:** Array of visitor objects.
**Success status:** `200 OK`
**Notes:** Non-`ADMIN` users see only their own agency.

### GET /api/visitors/{visitor_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`, `SECURITY`
**Response body:** Visitor object.
**Success status:** `200 OK`

---

## 8. Tickets

### POST /api/tickets

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Request body:**

```json
{
  "visitor_id": "VISITOR_UUID",
  "service_id": "SERVICE_UUID",
  "service_type": "Virement et consultation"
}
```

**Response body:**

```json
{
  "id": "TICKET_UUID",
  "visitor_id": "VISITOR_UUID",
  "visitor_name": "Client Test",
  "agency_id": "AGENCY_UUID",
  "service_id": "SERVICE_UUID",
  "service_code": "VIR",
  "service_name": "Virement et consultation",
  "counter_id": null,
  "ticket_number": "20260825-VIR-001",
  "service_type": "Virement et consultation",
  "status": "WAITING",
  "created_at": "2026-08-25T14:32:00Z",
  "called_at": null,
  "completed_at": null
}
```

**Success status:** `201 Created`
**Notes:** `service_id` is required and must belong to the visitor's agency.
Ticket numbers use `YYYYMMDD-SERVICE_CODE-001` and restart for each agency,
service and day.

### GET /api/tickets/queue?service_id=SERVICE_UUID

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:** Array of ticket objects in `WAITING` status, oldest first.
**Success status:** `200 OK`
**Notes:** `service_id` is optional. Non-`ADMIN` users see only their own
agency queue.

### POST /api/tickets/{ticket_id}/call

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Request body:**

```json
{
  "counter_id": "COUNTER_UUID"
}
```

**Response body:** Ticket object with `status: "CALLED"`, `counter_id` and
`called_at` populated.
**Success status:** `200 OK`
**Notes:** The ticket must be `WAITING`. The counter must be open, belong to
the same agency and be assigned to the ticket's service and point type.
Always send the counter UUID, never the visible counter number.

### POST /api/tickets/{ticket_id}/complete

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:** Ticket object with `status: "COMPLETED"` and
`completed_at`.
**Success status:** `200 OK`
**Notes:** Only `CALLED` and `IN_SERVICE` tickets can be completed.

### POST /api/tickets/{ticket_id}/cancel

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `AGENT`
**Response body:** Ticket object with `status: "CANCELLED"`.
**Success status:** `200 OK`
**Notes:** `COMPLETED` and already `CANCELLED` tickets cannot be cancelled.

### Ticket status values

`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`

---

## 9. IoT devices

### GET /api/devices

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Response body:**

```json
[
  {
    "id": "DEVICE_UUID",
    "agency_id": "AGENCY_UUID",
    "name": "Capteur DHT22",
    "device_type": "DHT22",
    "mqtt_client_id": "dht22-001",
    "mqtt_topic": "agency/AGENCY_UUID/device/dht22-001/sensor",
    "status": "ONLINE",
    "last_seen_at": "2026-08-25T10:00:00Z"
  }
]
```

**Success status:** `200 OK`
**Notes:** `MANAGER` and `TECHNICIAN` see devices from their own agency.

### POST /api/devices/agencies/{agency_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Request body:**

```json
{
  "name": "Capteur DHT22",
  "device_type": "DHT22",
  "mqtt_client_id": "dht22-001",
  "mqtt_topic": null
}
```

**Response body:**

```json
{
  "id": "DEVICE_UUID",
  "agency_id": "AGENCY_UUID",
  "name": "Capteur DHT22",
  "device_type": "DHT22",
  "mqtt_client_id": "dht22-001",
  "mqtt_topic": "agency/AGENCY_UUID/device/dht22-001/sensor",
  "status": "OFFLINE",
  "last_seen_at": null,
  "device_key": "DEVICE_SECRET_KEY"
}
```

**Success status:** `201 Created`
**Notes:** `device_key` is returned once only. Store it securely in the device;
it must never be committed to GitHub.

### GET /api/devices/{device_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Response body:** One device object.
**Success status:** `200 OK`

### PUT /api/devices/{device_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Request body:**

```json
{
  "name": "Capteur DHT22 principal",
  "device_type": "DHT22",
  "mqtt_client_id": "dht22-001",
  "status": "ONLINE"
}
```

**Response body:** Updated device object.
**Success status:** `200 OK`

### POST /api/devices/{device_id}/rotate-key

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** Device object with a new `device_key`.
**Success status:** `200 OK`
**Notes:** The previous key becomes invalid immediately.

### DELETE /api/devices/{device_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Response body:** Empty
**Success status:** `204 No Content`

---

## 10. Sensor thresholds

### GET /api/devices/{device_id}/thresholds

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Response body:**

```json
[
  {
    "id": "THRESHOLD_UUID",
    "device_id": "DEVICE_UUID",
    "sensor_type": "temperature",
    "unit": "C",
    "warning_max": 30,
    "critical_max": 40,
    "is_active": true
  }
]
```

**Success status:** `200 OK`

### PUT /api/devices/{device_id}/thresholds/{sensor_type}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Request body:**

```json
{
  "unit": "C",
  "warning_max": 30,
  "critical_max": 40,
  "is_active": true
}
```

**Response body:** Sensor threshold object.
**Success status:** `200 OK`
**Notes:** At least one limit is required. `warning_max` must be less than or
equal to `critical_max`.

### DELETE /api/devices/{device_id}/thresholds/{sensor_type}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `TECHNICIAN`
**Response body:** Empty
**Success status:** `204 No Content`

---

## 11. Cameras

### GET /api/agencies/{agency_id}/cameras

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Response body:**

```json
[
  {
    "id": "CAMERA_UUID",
    "agency_id": "AGENCY_UUID",
    "name": "cam1",
    "stream_url": "rtsp://192.168.1.16:8554/stream",
    "status": "OFFLINE"
  }
]
```

**Success status:** `200 OK`
**Notes:** Non-`ADMIN` users can access only their own agency.

### POST /api/agencies/{agency_id}/cameras

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Request body:**

```json
{
  "name": "cam1",
  "stream_url": "rtsp://192.168.1.16:8554/stream"
}
```

**Response body:** Camera object.
**Success status:** `201 Created`
**Notes:** `name` is the exact source identifier used by the AI service.
Camera names are unique globally because the current AI source registry is
site-wide. `status` starts as `OFFLINE` and becomes `ONLINE` after the backend
receives a detection stream event.

### PUT /api/cameras/{camera_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Request body:**

```json
{
  "name": "cam1",
  "stream_url": "rtsp://192.168.1.16:8554/stream"
}
```

**Response body:** Camera object.
**Success status:** `200 OK`

### DELETE /api/cameras/{camera_id}

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`
**Response body:** Empty
**Success status:** `204 No Content`

---

## 12. AI weapon alert threshold

### GET /api/ai-alerts/thresholds/weapon

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Response body:**

```json
{
  "confidence": 0.6
}
```

**Success status:** `200 OK`

### PUT /api/ai-alerts/thresholds/weapon

**Owner:** Backend
**Type:** REST
**Roles:** `ADMIN`, `MANAGER`, `SECURITY`
**Request body:**

```json
{
  "confidence": 0.65
}
```

**Response body:**

```json
{
  "confidence": 0.65
}
```

**Success status:** `200 OK`
**Notes:** The value is global and must be strictly greater than `0` and less
than or equal to `1`. It is persisted in PostgreSQL and applied immediately
by the backend consumer. It is separate from the AI model's own `conf` value.

The backend consumes `WS /weapon/alerts/stream`, registers all configured
camera names and stream URLs with the AI service, filters detections below this
threshold, and creates or resolves `weapon` alerts linked to the matching
camera and agency.

---

## 13. System

### GET /health

**Owner:** Backend
**Type:** REST
**Roles:** Public
**Response body:**

```json
{
  "status": "ok"
}
```

**Success status:** `200 OK`

---

## Permission summary

- **ADMIN:** global access to agencies, users, employees, visitors, tickets,
  attendance, services and IoT resources.
- **MANAGER:** access restricted to their own agency; can manage agency
  resources according to the endpoint role list.
- **AGENT:** manages visitors, tickets and can read services and service
  points.
- **SECURITY:** manages attendance and visitors.
- **TECHNICIAN:** manages IoT devices and sensor thresholds.
