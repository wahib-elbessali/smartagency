# Public API Contract (egress)

REST + WebSocket surface consumed by the frontend. Owned by whoever builds each endpoint — they write and maintain their own contract entries.

Any change that alters or removes an existing field or endpoint, not just adding a new optional field, must prefix the PR title with `BREAKING:` and be announced in `#api-contract`.

**Conventions:**
- **Request body** describes what the client sends. A field not listed there is not accepted by that endpoint.
- **Response body** describes what the API returns on success.
- **Success status** is the HTTP status code returned when the request succeeds.
- Error status codes are listed under **Notes**, with the condition that triggers them.
- Unless stated otherwise, `role` and `status` values are matched case-insensitively, but are always returned in upper case (e.g. `"ADMIN"`, `"ACTIVE"`).
- All endpoints below (except `POST /api/auth/register` and `POST /api/auth/login`) require a valid Bearer access token; a missing or invalid token returns `401 Unauthorized`.

---

## Authentication

### POST /api/auth/register
**Owner:** Backend
**Type:** REST
**Roles:** Public (no authentication required)
**Request body:**
{
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "password": "SecurePass123",
  "agency_id": null
}
**Response body:**
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "AGENT",
  "agency_id": null,
  "is_active": true
}
**Success status:** 201 Created
**Notes:**
- Public registration always creates an `AGENT` account. Any `role` value sent in the request is ignored.
- `full_name` (2–150 chars), `email` (5–255 chars) and `password` (8–72 chars) are required.
- `agency_id` is optional. When provided, the new account is pre-assigned to that agency.
- Errors: 409 Conflict if `email` is already registered; 404 Not Found if `agency_id` is provided and does not correspond to an existing agency; 422 Unprocessable Entity if `full_name`, `email` or `password` fail validation.

### POST /api/auth/login
**Owner:** Backend
**Type:** REST
**Roles:** Public (no authentication required)
**Request body:**
{
  "email": "admin@test.com",
  "password": "SecurePass123"
}
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- Authenticates a user and returns access and refresh tokens.
- Errors: 401 Unauthorized if the email is unknown or the password is incorrect; 403 Forbidden if the account exists but is disabled (`is_active: false`).

### GET /api/auth/me
**Owner:** Backend
**Type:** REST
**Roles:** Any authenticated user
**Response body:**
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "MANAGER",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
**Success status:** 200 OK
**Notes:**
- Requires a valid Bearer access token for a user account that is still active; otherwise returns 401 Unauthorized.

### POST /api/auth/refresh
**Owner:** Backend
**Type:** REST
**Roles:** Public (requires a valid refresh token instead of an access token)
**Request body:**
{
  "refresh_token": "JWT_REFRESH_TOKEN"
}
**Response body:**
{
  "access_token": "NEW_JWT_ACCESS_TOKEN",
  "refresh_token": "NEW_JWT_REFRESH_TOKEN",
  "token_type": "bearer",
  "user": {
    "id": "USER_UUID",
    "full_name": "Ahmed Benali",
    "email": "ahmed@agency.com",
    "role": "MANAGER",
    "agency_id": "AGENCY_UUID",
    "is_active": true
  }
}
**Success status:** 200 OK
**Notes:**
- Requires a valid, non-expired refresh token.
- Errors: 401 Unauthorized if the refresh token is missing, invalid, expired, or if the associated user no longer exists or has been disabled.

---

## Agencies

### GET /api/agencies
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (AGENT, SECURITY and TECHNICIAN receive 403 Forbidden)
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- ADMIN sees all agencies. MANAGER sees only their own agency.

### POST /api/agencies
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only (403 Forbidden for all other roles, including MANAGER)
**Request body:**
{
  "name": "Agence Casablanca",
  "address": "Casablanca",
  "phone": "0522000000",
  "opening_time": "08:30:00",
  "closing_time": "16:30:00",
  "zones": [
    { "name": "Accueil", "zone_type": "PUBLIC", "is_private": false }
  ],
  "counters": [
    { "number": 1, "name": "Guichet 1", "is_open": true }
  ]
}
**Response body:**
{
  "id": "AGENCY_UUID",
  "name": "Agence Casablanca",
  "address": "Casablanca",
  "phone": "0522000000",
  "opening_time": "08:30:00",
  "closing_time": "16:30:00",
  "is_active": true,
  "zones": [
    { "id": "ZONE_UUID", "name": "Accueil", "zone_type": "PUBLIC", "is_private": false }
  ],
  "counters": [
    { "id": "COUNTER_UUID", "number": 1, "name": "Guichet 1", "is_open": true }
  ],
  "employees_count": 0,
  "devices_count": 0,
  "cameras_count": 0
}
**Success status:** 201 Created
**Notes:**
- `name` (2–150 chars) is required. `address`, `phone`, `opening_time` and `closing_time` are optional.
- `zones` and `counters` are optional lists, created together with the agency.
- Each counter's `number` must be unique within the agency.
- Errors: 422 Unprocessable Entity for invalid field values; 409 Conflict if two counters in the request share the same `number`.

### GET /api/agencies/{agency_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- ADMIN can access any agency. MANAGER can only access their own agency.
- Errors: 404 Not Found if the agency does not exist; 403 Forbidden if a MANAGER requests an agency other than their own.

### PUT /api/agencies/{agency_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (own agency only)
**Request body:**
{
  "name": "Agence Casablanca Updated",
  "address": "New address",
  "closing_time": "17:00:00",
  "is_active": true
}
**Response body:**
{
  "id": "AGENCY_UUID",
  "name": "Agence Casablanca Updated",
  "address": "New address",
  "phone": "0522000000",
  "opening_time": "08:30:00",
  "closing_time": "17:00:00",
  "is_active": true,
  "zones": [],
  "counters": [],
  "employees_count": 4,
  "devices_count": 2,
  "cameras_count": 3
}
**Success status:** 200 OK
**Notes:**
- All fields are optional; only the fields included in the request are updated.
- ADMIN can update any agency. MANAGER can only update their own agency.
- Errors: 404 Not Found if the agency does not exist; 403 Forbidden if a MANAGER targets an agency other than their own; 422 Unprocessable Entity for invalid field values.

### DELETE /api/agencies/{agency_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Response body:**
{}
**Success status:** 204 No Content
**Notes:**
- Deleting an agency also deletes its zones, counters, employees, visitors, devices, cameras and alerts.
- Errors: 404 Not Found if the agency does not exist; 403 Forbidden for any non-ADMIN role.

---

## Employees

### GET /api/employees
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (AGENT, SECURITY and TECHNICIAN receive 403 Forbidden)
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- ADMIN sees all employees. MANAGER sees only employees from their own agency.

### POST /api/employees
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (AGENT, SECURITY and TECHNICIAN receive 403 Forbidden)
**Request body:**
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
**Response body:**
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
**Success status:** 201 Created
**Notes:**
- `first_name` and `last_name` (2–100 chars each) are required. `status` defaults to `ACTIVE` when omitted; valid values are `ACTIVE`, `INACTIVE`, `ON_LEAVE`.
- `is_active` is derived automatically from `status` (`ACTIVE` → `true`, any other status → `false`); it cannot be set directly.
- For an ADMIN caller, `agency_id` is required. For a MANAGER caller, any `agency_id` sent in the request is ignored and the employee is always created under the manager's own agency.
- `email` and `rfid_uid`, when provided, must be unique across all employees.
- Errors: 404 Not Found if `agency_id` does not exist; 409 Conflict if `email` or `rfid_uid` is already used; 422 Unprocessable Entity if `agency_id` is missing for an ADMIN caller, if `status` is not a valid value, or for other field validation failures.

### GET /api/employees/{employee_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- ADMIN can access any employee. MANAGER can only access employees from their own agency.
- Errors: 404 Not Found if the employee does not exist; 403 Forbidden if a MANAGER requests an employee outside their own agency.

### PUT /api/employees/{employee_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (own agency only)
**Request body:**
{
  "email": "ahmed.updated@agency.com",
  "position": "Supervisor",
  "status": "ACTIVE"
}
**Response body:**
{
  "id": "EMPLOYEE_UUID",
  "agency_id": "AGENCY_UUID",
  "first_name": "Ahmed",
  "last_name": "Benali",
  "email": "ahmed.updated@agency.com",
  "phone": "0612345678",
  "position": "Supervisor",
  "rfid_uid": "RFID-001",
  "status": "ACTIVE",
  "hire_date": "2026-08-01",
  "is_active": true
}
**Success status:** 200 OK
**Notes:**
- All fields are optional; only the fields included in the request are updated. Changing `status` re-derives `is_active` the same way as on creation.
- MANAGER cannot move an employee to another agency: sending an `agency_id` different from their own agency returns 403 Forbidden.
- Errors: 404 Not Found if the employee or the new `agency_id` does not exist; 409 Conflict if `email` or `rfid_uid` is already used; 422 Unprocessable Entity if `status` is not a valid value; 403 Forbidden if a MANAGER targets an employee outside their own agency or attempts to change its agency.

### DELETE /api/employees/{employee_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER (own agency only)
**Response body:**
{}
**Success status:** 204 No Content
**Notes:**
- MANAGER can only delete employees from their own agency.
- Errors: 404 Not Found if the employee does not exist; 403 Forbidden if a MANAGER targets an employee outside their own agency.

---

## Users, roles and permissions

All endpoints in this section are restricted to **ADMIN**; every other role receives 403 Forbidden.

### GET /api/users
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- Password hashes are never returned.

### POST /api/users
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Request body:**
{
  "full_name": "Sara Security",
  "email": "sara@agency.com",
  "password": "SecurePass123",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID"
}
**Response body:**
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
**Success status:** 201 Created
**Notes:**
- Creates a user and optionally links it to one employee via `employee_id`.
- Valid roles are `ADMIN`, `MANAGER`, `AGENT`, `SECURITY` and `TECHNICIAN` (defaults to `AGENT` if omitted).
- An `ADMIN` account must have `agency_id: null`. Every other role requires a valid `agency_id`.
- When `employee_id` is provided, the target employee must exist, must not already be linked to another user, and must belong to the same agency as `agency_id`.
- Errors: 404 Not Found if `agency_id` or `employee_id` does not exist; 409 Conflict if `email` is already registered or the employee is already linked to another user; 422 Unprocessable Entity if the role/agency combination is invalid (see above) or the employee's agency does not match `agency_id`.

### GET /api/users/{user_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- Errors: 404 Not Found if the user does not exist.

### PUT /api/users/{user_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Request body:**
{
  "full_name": "Sara Security Updated",
  "email": "sara.updated@agency.com",
  "is_active": true,
  "employee_id": "EMPLOYEE_UUID"
}
**Response body:**
{
  "id": "USER_UUID",
  "full_name": "Sara Security Updated",
  "email": "sara.updated@agency.com",
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "is_active": true,
  "employee": null
}
**Success status:** 200 OK
**Notes:**
- All fields are optional; only the fields included in the request are updated. Passwords are never returned.
- This endpoint does not change `role` or `agency_id` — use `PATCH /api/users/{user_id}/role`, `/agency` or `/access` for that.
- The same employee-linking rules as `POST /api/users` apply when `employee_id` is changed.
- Errors: 404 Not Found if the user, or a newly provided `employee_id`, does not exist; 409 Conflict if `email` is already used or the employee is already linked to another user; 422 Unprocessable Entity if the employee's agency does not match the user's current `agency_id`.

### PATCH /api/users/{user_id}/role
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Request body:**
{
  "role": "TECHNICIAN"
}
**Response body:**
{
  "id": "USER_UUID",
  "full_name": "Sara Security",
  "email": "sara@agency.com",
  "role": "TECHNICIAN",
  "agency_id": "AGENCY_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "is_active": true,
  "employee": null
}
**Success status:** 200 OK
**Notes:**
- Changes only the user's role; `agency_id` is not part of the request.
- Converting the role to `ADMIN` automatically clears `agency_id` to `null`.
- Converting the role to anything other than `ADMIN` requires the user's current `agency_id` to already be set to a valid agency; if it is not (for example when converting an existing `ADMIN` account), the request fails with 422 Unprocessable Entity.
- For simultaneous role and agency changes, use `PATCH /api/users/{user_id}/access` instead.

### PATCH /api/users/{user_id}/agency
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Request body:**
{
  "agency_id": "AGENCY_UUID"
}
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- Changes the user's agency and, when the user is linked to an employee, the linked employee's `agency_id` as well.
- `agency_id` must be `null` if the user's current role is `ADMIN`, and a valid existing agency otherwise.
- For simultaneous role and agency changes, use `PATCH /api/users/{user_id}/access` instead.
- Errors: 404 Not Found if `agency_id` does not exist; 422 Unprocessable Entity if `agency_id` is incompatible with the user's current role.

### PATCH /api/users/{user_id}/access
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Request body:**
{
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID"
}
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- Updates the role and agency atomically, validated together against their final state. Use this endpoint when changing both values, especially when converting an ADMIN account into a role assigned to an agency.
- Valid roles are `ADMIN`, `MANAGER`, `AGENT`, `SECURITY` and `TECHNICIAN`. An `ADMIN` must have `agency_id: null`; all other roles require a valid agency.
- When the user is linked to an employee, the linked employee's `agency_id` is also updated to the new `agency_id` (same behavior as `PATCH /api/users/{user_id}/agency`).
- Errors: 404 Not Found if `agency_id` does not exist; 422 Unprocessable Entity if the role/agency combination is invalid.

### DELETE /api/users/{user_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN only
**Response body:**
{}
**Success status:** 204 No Content
**Notes:**
- An ADMIN cannot delete their own account: this returns 400 Bad Request.
- Errors: 404 Not Found if the user does not exist; 400 Bad Request when attempting to delete the caller's own account.

---

## RFID attendance

### POST /api/attendance/check-in
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, SECURITY (AGENT and TECHNICIAN receive 403 Forbidden)
**Request body:**
{
  "employee_rfid": "RFID-001",
  "timestamp": "2026-08-01T12:00:00Z",
  "agency_id": null
}
**Response body:**
{
  "id": "ATTENDANCE_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T12:00:00Z",
  "check_out": null,
  "method": "RFID"
}
**Success status:** 200 OK
**Notes:**
- The employee is identified by `employee_rfid`, which must belong to an employee whose status is `ACTIVE`. `timestamp` is optional and defaults to the current time.
- `agency_id` is optional and accepted by the request schema, but has no effect on which employee is selected: the employee is always identified by `employee_rfid` alone.
- MANAGER and SECURITY can only check in employees of their own agency.
- If the employee already has an open attendance record (no `check_out` yet), this returns that existing record instead of creating a new one.
- Errors: 404 Not Found if `employee_rfid` does not match an active employee; 403 Forbidden if a MANAGER/SECURITY caller targets an employee outside their own agency.

### POST /api/attendance/check-out
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, SECURITY (AGENT and TECHNICIAN receive 403 Forbidden)
**Request body:**
{
  "employee_rfid": "RFID-001",
  "timestamp": "2026-08-01T16:30:00Z",
  "agency_id": null
}
**Response body:**
{
  "id": "ATTENDANCE_UUID",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T08:30:00Z",
  "check_out": "2026-08-01T16:30:00Z",
  "method": "RFID"
}
**Success status:** 200 OK
**Notes:**
- Closes the employee's current open attendance record (the most recent one without a `check_out`).
- `agency_id` is optional and accepted by the request schema, but has no effect on the check-out logic: the open record is always found via `employee_rfid` alone.
- MANAGER and SECURITY can only check out employees of their own agency.
- Errors: 404 Not Found if `employee_rfid` does not match an active employee; 409 Conflict if the employee has no open attendance record; 403 Forbidden if a MANAGER/SECURITY caller targets an employee outside their own agency.

### GET /api/attendance/today
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, SECURITY (AGENT and TECHNICIAN receive 403 Forbidden)
**Response body:**
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
**Success status:** 200 OK
**Notes:**
- ADMIN sees records from all agencies. MANAGER and SECURITY see their own agency only.

### GET /api/attendance/employee/{employee_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, SECURITY (AGENT and TECHNICIAN receive 403 Forbidden)
**Response body:**
[
  {
    "id": "ATTENDANCE_UUID",
    "employee_id": "EMPLOYEE_UUID",
    "employee_name": "Ahmed Benali",
    "agency_id": "AGENCY_UUID",
    "check_in": "2026-08-01T08:30:00Z",
    "check_out": "2026-08-01T16:30:00Z",
    "method": "RFID"
  }
]
**Success status:** 200 OK
**Notes:**
- Returns the attendance history of one employee, most recent first.
- MANAGER and SECURITY can only access employees from their own agency.
- Errors: 404 Not Found if the employee does not exist; 403 Forbidden if a MANAGER/SECURITY caller targets an employee outside their own agency.

### WS /ws/attendance
**Owner:** Backend
**Type:** WebSocket
**Roles:** Any authenticated user (valid JWT passed as `?token=`)
**Response body:**
{
  "id": "ATTENDANCE_UUID",
  "type": "attendance_updated",
  "event": "check_in",
  "employee_id": "EMPLOYEE_UUID",
  "employee_name": "Ahmed Benali",
  "agency_id": "AGENCY_UUID",
  "check_in": "2026-08-01T12:00:00Z",
  "check_out": null,
  "method": "RFID"
}
**Notes:**
- Requires a valid JWT token. The `id` field is always present. MQTT-triggered events additionally include `device_id`. REST-triggered events (check-in/check-out) do not include `device_id`.

---

## Visitors

### POST /api/visitors
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT, SECURITY (TECHNICIAN receives 403 Forbidden)
**Request body:**
{
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "agency_id": "AGENCY_UUID"
}
**Response body:**
{
  "id": "VISITOR_UUID",
  "agency_id": "AGENCY_UUID",
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "created_at": "2026-08-08T12:00:00Z"
}
**Success status:** 201 Created
**Notes:**
- `full_name` (2–150 chars) is required.
- For an ADMIN caller, `agency_id` is required. For any non-ADMIN caller, `agency_id` in the request is ignored and the visitor is always created under the caller's own agency.
- Errors: 404 Not Found if `agency_id` does not exist; 422 Unprocessable Entity if `agency_id` is missing for an ADMIN caller.

### GET /api/visitors
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT, SECURITY (TECHNICIAN receives 403 Forbidden)
**Response body:**
[
  {
    "id": "VISITOR_UUID",
    "agency_id": "AGENCY_UUID",
    "full_name": "Client Test",
    "phone": "0612345678",
    "identity_reference": "CIN123456",
    "created_at": "2026-08-08T12:00:00Z"
  }
]
**Success status:** 200 OK
**Notes:**
- ADMIN sees visitors from all agencies. Other authorized roles see visitors from their own agency only.

### GET /api/visitors/{visitor_id}
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT, SECURITY (TECHNICIAN receives 403 Forbidden)
**Response body:**
{
  "id": "VISITOR_UUID",
  "agency_id": "AGENCY_UUID",
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "created_at": "2026-08-08T12:00:00Z"
}
**Success status:** 200 OK
**Notes:**
- Access is restricted by agency for non-ADMIN users.
- Errors: 404 Not Found if the visitor does not exist; 403 Forbidden if a non-ADMIN caller requests a visitor outside their own agency.

---

## Tickets

### POST /api/tickets
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT (SECURITY and TECHNICIAN receive 403 Forbidden)
**Request body:**
{
  "visitor_id": "VISITOR_UUID",
  "service_type": "Ouverture de compte"
}
**Response body:**
{
  "id": "TICKET_UUID",
  "visitor_id": "VISITOR_UUID",
  "visitor_name": "Client Test",
  "agency_id": "AGENCY_UUID",
  "counter_id": null,
  "ticket_number": "20260808-001",
  "service_type": "Ouverture de compte",
  "status": "WAITING",
  "created_at": "2026-08-08T12:00:00Z",
  "called_at": null,
  "completed_at": null
}
**Success status:** 201 Created
**Notes:**
- `visitor_id` is required and must reference an existing visitor. `service_type` is optional.
- Non-ADMIN users can only create a ticket for a visitor belonging to their own agency.
- `ticket_number` is generated automatically, formatted `{YYYYMMDD}-{sequence}`, restarting at `001` for each agency and each calendar day.
- New tickets always start in `WAITING` status.
- Errors: 404 Not Found if `visitor_id` does not exist; 403 Forbidden if a non-ADMIN caller targets a visitor outside their own agency.

### GET /api/tickets/queue
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT (SECURITY and TECHNICIAN receive 403 Forbidden)
**Response body:**
[
  {
    "id": "TICKET_UUID",
    "visitor_id": "VISITOR_UUID",
    "visitor_name": "Client Test",
    "agency_id": "AGENCY_UUID",
    "counter_id": null,
    "ticket_number": "20260808-001",
    "service_type": "Ouverture de compte",
    "status": "WAITING",
    "created_at": "2026-08-08T12:00:00Z",
    "called_at": null,
    "completed_at": null
  }
]
**Success status:** 200 OK
**Notes:**
- Returns tickets currently in `WAITING` status, oldest first. Non-ADMIN users see only their own agency's queue.

### POST /api/tickets/{ticket_id}/call
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT (SECURITY and TECHNICIAN receive 403 Forbidden)
**Request body:**
{
  "counter_id": "COUNTER_UUID"
}
**Response body:**
{
  "id": "TICKET_UUID",
  "visitor_id": "VISITOR_UUID",
  "visitor_name": "Client Test",
  "agency_id": "AGENCY_UUID",
  "counter_id": "COUNTER_UUID",
  "ticket_number": "20260808-001",
  "service_type": "Ouverture de compte",
  "status": "CALLED",
  "created_at": "2026-08-08T12:00:00Z",
  "called_at": "2026-08-08T12:05:00Z",
  "completed_at": null
}
**Success status:** 200 OK
**Notes:**
- The ticket must currently be in `WAITING` status.
- Requires a valid counter UUID belonging to the same agency as the ticket; the counter must also be open (`is_open: true`). The visible counter number must not be used instead of `counter_id`.
- Non-ADMIN users can only call tickets belonging to their own agency.
- On success, the ticket moves to `CALLED`, and `counter_id` / `called_at` are set.
- Errors: 404 Not Found if the ticket or the counter does not exist; 409 Conflict if the ticket is not `WAITING` or the counter is closed; 422 Unprocessable Entity if the counter belongs to a different agency than the ticket; 403 Forbidden if a non-ADMIN caller targets a ticket outside their own agency.

### POST /api/tickets/{ticket_id}/complete
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT (SECURITY and TECHNICIAN receive 403 Forbidden)
**Response body:**
{
  "id": "TICKET_UUID",
  "visitor_id": "VISITOR_UUID",
  "visitor_name": "Client Test",
  "agency_id": "AGENCY_UUID",
  "counter_id": "COUNTER_UUID",
  "ticket_number": "20260808-001",
  "service_type": "Ouverture de compte",
  "status": "COMPLETED",
  "created_at": "2026-08-08T12:00:00Z",
  "called_at": "2026-08-08T12:05:00Z",
  "completed_at": "2026-08-08T12:20:00Z"
}
**Success status:** 200 OK
**Notes:**
- A ticket can be completed from `CALLED` or `IN_SERVICE` state only.
- Non-ADMIN users can only complete tickets belonging to their own agency.
- On success, the ticket moves to `COMPLETED` and `completed_at` is set.
- Errors: 404 Not Found if the ticket does not exist; 409 Conflict if the ticket is not `CALLED` or `IN_SERVICE`; 403 Forbidden if a non-ADMIN caller targets a ticket outside their own agency.

### POST /api/tickets/{ticket_id}/cancel
**Owner:** Backend
**Type:** REST
**Roles:** ADMIN, MANAGER, AGENT (SECURITY and TECHNICIAN receive 403 Forbidden)
**Response body:**
{
  "id": "TICKET_UUID",
  "visitor_id": "VISITOR_UUID",
  "visitor_name": "Client Test",
  "agency_id": "AGENCY_UUID",
  "counter_id": null,
  "ticket_number": "20260808-001",
  "service_type": "Ouverture de compte",
  "status": "CANCELLED",
  "created_at": "2026-08-08T12:00:00Z",
  "called_at": null,
  "completed_at": null
}
**Success status:** 200 OK
**Notes:**
- A ticket that is already `COMPLETED` or `CANCELLED` cannot be cancelled again. Any other status, including `WAITING` and `CALLED`, can be cancelled.
- Non-ADMIN users can only cancel tickets belonging to their own agency.
- Errors: 404 Not Found if the ticket does not exist; 409 Conflict if the ticket is already `COMPLETED` or `CANCELLED`; 403 Forbidden if a non-ADMIN caller targets a ticket outside their own agency.

---

## Reference: ticket status values

Not an endpoint — listed here for reference. `status` on a ticket is one of:

`WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`

Tickets normally follow `WAITING` → `CALLED` → `COMPLETED`. A ticket can also be cancelled before completion (see `POST /api/tickets/{ticket_id}/cancel`).

---

## Reference: common permission rules

Not an endpoint — general summary of what each role is for. Role restrictions specific to a given endpoint are stated in that endpoint's own Notes above; this section does not override them.

Roles: `ADMIN`, `MANAGER`, `AGENT`, `SECURITY`, `TECHNICIAN`.

- **ADMIN** — Global access to all agencies and resources, including user management.
- **MANAGER** — Restricted to their own agency.
- **AGENT** — Manages visitors and tickets.
- **SECURITY** — Manages attendance and security operations.
- **TECHNICIAN** — Manages IoT devices and sensors.
