# Public API Contract (egress)

REST + WebSocket surface consumed by the frontend. Owned by whoever builds each endpoint — they write and maintain their own contract entries.

Any change that alters or removes an existing field or endpoint, not just adding a new optional field, must prefix the PR title with `BREAKING:` and be announced in `#api-contract`.

---

## Authentication

### POST /api/auth/register
**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "AGENT",
  "agency_id": null,
  "is_active": true
}
**Notes:** Public registration always creates an AGENT account.

### POST /api/auth/login
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** Authenticates a user and returns access and refresh tokens.

### GET /api/auth/me
**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "id": "USER_UUID",
  "full_name": "Ahmed Benali",
  "email": "ahmed@agency.com",
  "role": "MANAGER",
  "agency_id": "AGENCY_UUID",
  "is_active": true
}
**Notes:** Requires a valid Bearer access token.

### POST /api/auth/refresh
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** Requires a valid refresh token.

---

## Agencies

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
**Notes:** ADMIN sees all agencies. MANAGER sees only their agency.

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

### GET /api/agencies/{agency_id}
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
  "employees_count": 4,
  "devices_count": 2,
  "cameras_count": 3
}
**Notes:** ADMIN can access all agencies. MANAGER can access their agency only.

### PUT /api/agencies/{agency_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** ADMIN can update all agencies. MANAGER can update their agency only.

### DELETE /api/agencies/{agency_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
{}
**Notes:** ADMIN only. Returns HTTP 204 on success.

---

## Employees

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
**Notes:** ADMIN sees all employees. MANAGER sees only employees from their agency.

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

### GET /api/employees/{employee_id}
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
**Notes:** ADMIN can access all employees. MANAGER can access employees from their agency only.

### PUT /api/employees/{employee_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** Requires ADMIN or MANAGER. MANAGER cannot move an employee to another agency.

### DELETE /api/employees/{employee_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
{}
**Notes:** Requires ADMIN or MANAGER. Returns HTTP 204 on success.

---

## Users, roles and permissions

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
  "is_active": true,
  "employee": null
}
**Notes:** ADMIN only. Creates a user and optionally links it to one employee.

### GET /api/users/{user_id}
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
  "is_active": true,
  "employee": null
}
**Notes:** ADMIN only.

### PUT /api/users/{user_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** ADMIN only. Passwords are never returned.

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
**Notes:** ADMIN only. Changes the user's role. For simultaneous role and agency changes, use
`PATCH /api/users/{user_id}/access`.

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
**Notes:** ADMIN only. Changes the user's agency and the linked employee agency. For simultaneous role and agency changes, use
`PATCH /api/users/{user_id}/access`.

### PATCH /api/users/{user_id}/access
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
  "is_active": true,
  "employee": null
}
**Request body:**
{
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID"
}
**Notes:** ADMIN only. Updates the role and agency atomically using the final state. Use this endpoint when changing both values, especially when converting an ADMIN account into a role assigned to an agency. Valid roles are ADMIN, MANAGER, AGENT, SECURITY and TECHNICIAN. An ADMIN must have `agency_id: null`; all other roles require a valid agency.

### DELETE /api/users/{user_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
{}
**Notes:** ADMIN only. An ADMIN cannot delete their own account.

---

## RFID attendance

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
**Notes:** Requires ADMIN, MANAGER or SECURITY. The request identifies the employee using employee_rfid.

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

### GET /api/attendance/employee/{employee_id}
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
    "check_out": "2026-08-01T16:30:00Z",
    "method": "RFID"
  }
]
**Notes:** Returns the attendance history of one employee.

### WS /ws/attendance
**Owner:** Backend  
**Type:** WebSocket  
**Payload:**
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
**Notes:** Requires a valid JWT token. The `id` field is always present. MQTT-triggered events additionally include `device_id`. REST-triggered events do not include `device_id`.

---

## Visitors

### POST /api/visitors
**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "id": "VISITOR_UUID",
  "agency_id": "AGENCY_UUID",
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "created_at": "2026-08-08T12:00:00Z"
}
**Notes:** ADMIN, MANAGER, AGENT and SECURITY can create visitors. Non-ADMIN users are restricted to their agency.

### GET /api/visitors
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** ADMIN sees visitors from all agencies. Other authorized roles see visitors from their agency only.

### GET /api/visitors/{visitor_id}
**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "id": "VISITOR_UUID",
  "agency_id": "AGENCY_UUID",
  "full_name": "Client Test",
  "phone": "0612345678",
  "identity_reference": "CIN123456",
  "created_at": "2026-08-08T12:00:00Z"
}
**Notes:** Access is restricted by agency for non-ADMIN users.

---

## Tickets

### POST /api/tickets
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** ADMIN, MANAGER and AGENT can create tickets. The ticket number is generated automatically per agency and day.

### GET /api/tickets/queue
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** Returns tickets currently waiting. Non-ADMIN users see only their agency queue.

### POST /api/tickets/{ticket_id}/call
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** Requires a valid counter UUID belonging to the same agency. The visible counter number must not be used instead of `counter_id`.

### POST /api/tickets/{ticket_id}/complete
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** A ticket can be completed from CALLED or IN_SERVICE state.

### POST /api/tickets/{ticket_id}/cancel
**Owner:** Backend  
**Type:** REST  
**Payload:**
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
**Notes:** A ticket that is already COMPLETED or CANCELLED cannot be cancelled again.

### Ticket statuses
**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "statuses": [
    "WAITING",
    "CALLED",
    "IN_SERVICE",
    "COMPLETED",
    "CANCELLED"
  ]
}
**Notes:** Tickets normally follow WAITING → CALLED → COMPLETED. A ticket can also be cancelled before completion.

---

## Common permission rules

**Owner:** Backend  
**Type:** REST  
**Payload:**
{
  "roles": [
    "ADMIN",
    "MANAGER",
    "AGENT",
    "SECURITY",
    "TECHNICIAN"
  ]
}
**Notes:** ADMIN has global access. MANAGER is restricted to their agency. AGENT manages visitors and tickets. SECURITY manages attendance and security operations. TECHNICIAN manages IoT devices and sensors.
