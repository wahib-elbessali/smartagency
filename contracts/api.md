# Public API Contract (egress)

REST + WebSocket surface the frontend consumes. Owned by whoever builds each endpoint — they write their own contract entries.

Any change that alters or removes an existing field/endpoint (not just adds a new optional one): prefix the PR title `BREAKING:` and flag it in `#api-contract`, don't just merge it as a routine notice.

Entry template:

```
### METHOD /path          (or "### WS /path" for a WebSocket stream)
**Owner:** 
**Type:** REST | WebSocket
**Payload:**
{
}
**Notes:** 
```

---

<!-- Add entries below, one per endpoint -->

### POST /api/auth/login
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "access_token": "JWT_ACCESS_TOKEN",
  "refresh_token": "JWT_REFRESH_TOKEN",
  "token_type": "bearer",
  "user": {
    "id": "UUID",
    "full_name": "Admin Test",
    "email": "admin@test.com",
    "role": "ADMIN",
    "agency_id": null,
    "is_active": true
  }
}
**Notes:** Authenticates a user and returns access and refresh tokens.

### GET /api/auth/me
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "MANAGER",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
**Notes:** Requires a Bearer access token.

### GET /api/agencies
**Owner:** Backend
**Type:** REST
**Payload:**
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
**Notes:** ADMIN sees all agencies. MANAGER sees only its agency.

### POST /api/agencies
**Owner:** Backend
**Type:** REST
**Payload:**
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
  "employees_count": 0,
  "devices_count": 0,
  "cameras_count": 0
}
**Notes:** ADMIN only. Creates an agency with optional zones and counters.

### GET /api/employees
**Owner:** Backend
**Type:** REST
**Payload:**
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
**Notes:** ADMIN sees all employees. MANAGER sees only employees from its agency.

### POST /api/employees
**Owner:** Backend
**Type:** REST
**Payload:**
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
**Notes:** Requires ADMIN or MANAGER. RFID UID must be unique.

### GET /api/users
**Owner:** Backend
**Type:** REST
**Payload:**
[
  {
    "id": "USER_UUID",
    "full_name": "Sara Security",
    "email": "sara@agency.com",
    "role": "SECURITY",
    "agency_id": "AGENCY_UUID",
    "employee_id": "EMPLOYEE_UUID",
    "is_active": true
  }
]
**Notes:** ADMIN only. Password hashes are never returned.

### POST /api/users
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "USER_UUID",
  "full_name": "Sara Security",
  "email": "sara@agency.com",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "is_active": true
}
**Notes:** ADMIN only. Creates a user and optionally links it to one employee.

### PATCH /api/users/{user_id}/role
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "USER_UUID",
  "role": "TECHNICIAN",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
**Notes:** ADMIN only. Valid roles: ADMIN, MANAGER, AGENT, SECURITY, TECHNICIAN.

### PATCH /api/users/{user_id}/agency
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "USER_UUID",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
**Notes:** ADMIN only. Updates the user's agency and the linked employee agency.

### POST /api/attendance/check-in
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "ATTENDANCE_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T12:00:00Z",
  "check_out": null,
  "method": "RFID"
}
**Notes:** Requires ADMIN, MANAGER or SECURITY. Identifies the employee using employee_rfid.

### POST /api/attendance/check-out
**Owner:** Backend
**Type:** REST
**Payload:**
{
  "id": "ATTENDANCE_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T08:30:00Z",
  "check_out": "2026-08-01T16:30:00Z",
  "method": "RFID"
}
**Notes:** Closes the employee's current open attendance record.

### GET /api/attendance/today
**Owner:** Backend
**Type:** REST
**Payload:**
[
  {
    "id": "ATTENDANCE_UUID",
    "employee_id": "EMPLOYEE_UUID",
    "employee_name": "Ahmed Benali",
    "agency_id": "AGENCY_UUID",
    "check_in": "2026-08-01T08:30:00Z",
    "check_out": null,
    "method": "RFID"
  }
]
**Notes:** ADMIN sees all agencies. MANAGER and SECURITY see their agency only.

### WS /ws/attendance
**Owner:** Backend
**Type:** WebSocket
**Payload:**
{
  "type": "attendance_updated",
  "event": "check_in",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T12:00:00Z",
  "check_out": null,
  "method": "RFID",
  "device_id": "DEVICE_UUID"
}
**Notes:** Requires a valid JWT token. Used to notify the dashboard in real time.
