/**
 * Types transcribed from contracts/api.md, then corrected against the backend
 * schemas in backend/app/schemas/ and backend/app/models/entities.py.
 *
 * Reading both matters: the contract's examples show every field populated, but
 * the Pydantic response models mark several of them optional. Typing from the
 * examples alone produces types that claim more than the API guarantees.
 *
 * Where an enum's members are enforced by a database Enum column, the union
 * below is exact - the backend cannot emit anything else without a migration.
 * Where the contract showed one example and nothing enforces the rest, the type
 * stays `string`.
 */

/** Enforced by the `roles.name` Enum column. */
export const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'SECURITY', 'TECHNICIAN'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Enforced by the `employees.status` Enum column. */
export const EMPLOYEE_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

/**
 * Enforced by the `attendance.method` Enum column.
 *
 * Only RFID is ever written today - record_check_in() hard-codes it. The other
 * two exist in the schema for the facial recognition and manual paths that the
 * project brief calls for but nothing implements yet.
 */
export const ATTENDANCE_METHODS = ['RFID', 'FACE_RECOGNITION', 'MANUAL'] as const
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number]

/** Both are emitted; the MQTT message schema constrains them to this pair. */
export const ATTENDANCE_EVENTS = ['check_in', 'check_out'] as const
export type AttendanceEventKind = (typeof ATTENDANCE_EVENTS)[number]

/**
 * GET /api/auth/me, and the `user` object inside POST /api/auth/login.
 *
 * This is the *small* user shape. `/api/users` returns a larger one - see
 * `UserAccount` below, which is where `employee_id` and `employee` live. The
 * backend calls both models `UserResponse`, which is the trap: they are two
 * types with one name, and this one carries neither field.
 */
export interface User {
  id: string
  full_name: string
  email: string
  role: Role
  /** null for an ADMIN not scoped to one agency. */
  agency_id: string | null
  is_active: boolean
}

/** POST /api/auth/login and POST /api/auth/refresh both return this. */
export interface LoginResponse {
  access_token: string
  refresh_token: string
  /** Contract shows "bearer". Not narrowed - the casing is the backend's call. */
  token_type: string
  user: User
}

/** Nested in AgencyResponse. Shape from backend/app/schemas/agency.py. */
export interface Zone {
  id: string
  name: string
  /** Free text with a "PUBLIC" default, not an enum column. */
  zone_type: string
  is_private: boolean
}

export interface Counter {
  id: string
  number: number
  name: string | null
  is_open: boolean
}

/** GET|POST /api/agencies. Four fields are optional in AgencyResponse. */
export interface Agency {
  id: string
  name: string
  address: string | null
  phone: string | null
  /** "HH:MM:SS", local to the agency. There is no timezone field anywhere. */
  opening_time: string | null
  closing_time: string | null
  is_active: boolean
  zones: Zone[]
  counters: Counter[]
  employees_count: number
  devices_count: number
  cameras_count: number
}

/**
 * POST /api/agencies — nested zone, from the request body in the contract.
 *
 * No `id`: the server assigns it and returns the full Zone. Zones can only be
 * created alongside their agency - the contract exposes no route for adding one
 * to an agency that already exists, so the create form is the only place they
 * can be set.
 */
export interface ZoneCreate {
  name: string
  /** Free text with a "PUBLIC" default, matching Zone. */
  zone_type?: string
  is_private?: boolean
}

/** POST /api/agencies — nested counter. `number` must be unique per agency. */
export interface CounterCreate {
  number: number
  name?: string | null
  is_open?: boolean
}

/**
 * POST /api/agencies — the request body.
 *
 * Only `name` is required (2-150 chars). Everything else is optional, including
 * the two nested lists.
 *
 * `is_active` is absent on purpose. The response carries it, but the contract's
 * request body does not list it, and "a field not listed there is not accepted
 * by that endpoint" is the stated convention. A new agency is active; PUT is
 * where that changes.
 */
export interface AgencyCreate {
  name: string
  address?: string | null
  phone?: string | null
  /** "HH:MM:SS". */
  opening_time?: string | null
  closing_time?: string | null
  zones?: ZoneCreate[]
  counters?: CounterCreate[]
}

/**
 * PUT /api/agencies/{id} — from the contract's request body.
 *
 * "All fields are optional; only the fields included in the request are
 * updated", which is the same exclude_unset behaviour the employee route has.
 *
 * `zones` and `counters` are deliberately NOT here. The contract's PUT example
 * shows only scalar fields, and its response echoes the nested lists unchanged.
 * Sending them would be guessing at whether the backend replaces, merges or
 * ignores the list - three very different outcomes, one of which silently
 * destroys every counter in the agency. Editing those needs its own contract
 * entry before it gets a form.
 */
export interface AgencyUpdate {
  name?: string
  address?: string | null
  phone?: string | null
  opening_time?: string | null
  closing_time?: string | null
  is_active?: boolean
}

/** GET|POST /api/employees. Five fields are optional in EmployeeResponse. */
export interface Employee {
  id: string
  agency_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  position: string | null
  rfid_uid: string | null
  status: EmployeeStatus
  /** "YYYY-MM-DD". */
  hire_date: string | null
  is_active: boolean
}

/**
 * POST /api/employees — the request body, from EmployeeCreate.
 *
 * Only first_name and last_name are required. `status` defaults to ACTIVE
 * server-side, and `is_active` is derived from it rather than sent - the
 * backend sets is_active = (status === 'ACTIVE'), so exposing both in a form
 * would let them disagree.
 *
 * agency_id is required for an ADMIN (422 without it) and ignored for a
 * MANAGER, who can only ever create inside their own agency.
 */
export interface EmployeeCreate {
  first_name: string
  last_name: string
  email?: string | null
  phone?: string | null
  position?: string | null
  agency_id?: string | null
  rfid_uid?: string | null
  status?: EmployeeStatus
  hire_date?: string | null
}

/**
 * PUT /api/employees/{id} — from EmployeeUpdate.
 *
 * The backend uses `exclude_unset`, so an omitted key is left alone and an
 * explicit null clears the field. That distinction is real: sending
 * `{email: null}` erases the address, sending nothing keeps it.
 *
 * `agency_id` is narrowed to exclude null even though the schema allows it.
 * The column is NOT NULL, so sending null would fail at the database rather
 * than in validation - a 500 dressed as a user error. An employee always
 * belongs to an agency; moving them is a change, not a clearing.
 */
export type EmployeeUpdate = Partial<Omit<EmployeeCreate, 'agency_id'>> & {
  agency_id?: string
}

/**
 * The employee summary nested in a GET /api/users entry, from
 * EmployeeLinkResponse in backend/app/schemas/user.py.
 *
 * It is NOT an `Employee`: it carries five fields, not eleven. Reusing
 * `Employee` here would claim a `status` and a `hire_date` this payload never
 * sends.
 */
export interface EmployeeLink {
  id: string
  first_name: string
  last_name: string
  agency_id: string
  rfid_uid: string | null
}

/**
 * GET|POST /api/users, and the two PATCH routes.
 *
 * Deliberately a different type from `User` above, even though the backend
 * calls both of them `UserResponse`. `/api/auth/me` returns the smaller one;
 * `/api/users` adds `employee_id` and the nested `employee`. They are two
 * shapes with one name, and typing them as one would let a screen read
 * `.employee` off a payload that never carries it.
 *
 * `agency_id` is null for exactly one reason: the account is an ADMIN. See
 * validate_agency_for_role - an ADMIN must have no agency and every other role
 * must have one, which is the inverse of what you would guess.
 */
export interface UserAccount {
  id: string
  full_name: string
  email: string
  role: Role
  /** null if and only if the role is ADMIN. */
  agency_id: string | null
  employee_id: string | null
  is_active: boolean
  /** null when this login is not tied to a person with a card. */
  employee: EmployeeLink | null
}

/**
 * POST /api/users — the request body, from UserCreate.
 *
 * `password` is required (min 8, max 72) and is **not in contracts/api.md**:
 * the documented payload for this endpoint is the response, which of course
 * never contains it. Verified in backend/app/schemas/user.py.
 *
 * `role` defaults to AGENT server-side. `agency_id` is required for every role
 * except ADMIN, which must not have one.
 */
export interface UserCreate {
  full_name: string
  email: string
  password: string
  role?: Role
  agency_id?: string | null
  employee_id?: string | null
}

/**
 * PATCH /api/users/{id}/access — from AccessUpdate. Added by PR #75.
 *
 * Sets role and agency together, validating the **resulting** pair rather than
 * the account's current state. That is the whole point of it: `/role` and
 * `/agency` each check against the half the other one needs changed first, so
 * an ADMIN could never be moved to any other role. This route has no such
 * ordering problem.
 *
 * The inverted rule still holds and is still enforced here - ADMIN with an
 * agency is a 422, and any other role without one is a 422. Both verified by
 * running the route, not by reading it.
 */
export interface UserAccessUpdate {
  role: Role
  /** Must be null for ADMIN, and a real agency for every other role. */
  agency_id: string | null
}

/**
 * PUT /api/users/{id} — from UserUpdate.
 *
 * Note what is absent: `role` and `agency_id`. Those move only through their
 * own PATCH routes, because each has a side effect this route does not perform
 * (a promotion to ADMIN clears the agency; an agency move also relocates the
 * linked employee).
 *
 * `exclude_unset` again: an omitted key is left alone, an explicit null clears
 * it. Sending `{employee_id: null}` unlinks the person; omitting the key keeps
 * the existing link.
 */
export interface UserUpdate {
  full_name?: string
  email?: string
  /** Sets a new password. Omit to leave it unchanged - never send "". */
  password?: string
  is_active?: boolean
  employee_id?: string | null
}

/**
 * Enforced by the `tickets.status` Enum column.
 *
 * Five members, but only four are reachable through the API. `call` sets
 * CALLED, `complete` sets COMPLETED, `cancel` sets CANCELLED - nothing anywhere
 * sets IN_SERVICE. It is kept in the union because the database column has it
 * and a hand-written row could carry it, but no screen should offer it as an
 * action until the backend has a route that produces it.
 */
export const TICKET_STATUSES = [
  'WAITING',
  'CALLED',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/**
 * GET|POST /api/visitors, from VisitorResponse.
 *
 * A visitor is a member of the public who walked in - not an employee and not
 * an account. They are the only kind of person in this system with no login and
 * no card.
 */
export interface Visitor {
  id: string
  agency_id: string
  full_name: string
  phone: string | null
  identity_reference: string | null
  /** ISO 8601. */
  created_at: string
}

/**
 * POST /api/visitors — the request body, from VisitorCreate.
 *
 * `agency_id` is honoured only for an ADMIN. For every other role the backend
 * overwrites it with the caller's own agency, so sending one is pointless
 * rather than wrong. An ADMIN who omits it gets a 422.
 */
export interface VisitorCreate {
  full_name: string
  phone?: string | null
  identity_reference?: string | null
  agency_id?: string | null
}

/**
 * GET /api/tickets/queue and the four write routes, from TicketResponse.
 *
 * `visitor_name` and `agency_id` are flattened out of the visitor by the
 * backend, so a queue row needs no second request to be readable.
 */
export interface Ticket {
  id: string
  visitor_id: string
  visitor_name: string
  agency_id: string
  /** null until the ticket is called to a counter. */
  counter_id: string | null
  /** "YYYYMMDD-NNN", numbered per agency and restarting each day. */
  ticket_number: string
  service_type: string | null
  status: TicketStatus
  /** ISO 8601. */
  created_at: string
  called_at: string | null
  completed_at: string | null
}

/** POST /api/tickets — from TicketCreate. The visitor must already exist. */
export interface TicketCreate {
  visitor_id: string
  service_type?: string | null
}

/** POST /api/tickets/{id}/call — from TicketCallRequest. */
export interface TicketCall {
  counter_id: string
}

/**
 * The four computer-vision features that publish an alerts stream.
 *
 * From contracts/ai-service.md, which mounts `/{f}/alerts/stream` separately
 * per feature. Whether the backend proxy keeps them separate or merges them
 * into one is not settled yet - see the note on ALERT_STREAM_PATHS in
 * endpoints/streams.ts.
 */
export const ALERT_FEATURES = ['weapon', 'fire', 'emotion', 'wanted'] as const
export type AlertFeature = (typeof ALERT_FEATURES)[number]

/**
 * One detection inside an alerts frame.
 *
 * `class` is the detected label and its vocabulary depends on the feature -
 * "pistol" for weapon, a watchlist identifier for wanted. It is left as a
 * string because nothing in the contract enumerates them all.
 *
 * `confidence` means different things per feature and must not be rendered as
 * a percentage for `wanted`: there it is cosine similarity in [-1, 1], not a
 * probability. The contract says so explicitly.
 */
export interface AlertDetection {
  class: string
  confidence: number
  /** [x1, y1, x2, y2] in source-frame pixels. */
  bbox: [number, number, number, number]
  /** wanted only: face detector score, and the detected face size in pixels. */
  det_score?: number
  face_px?: number
  /**
   * wanted only: a base64 JPEG of the person, ~20KB, never written to disk.
   *
   * Attached once, to the highest-confidence detection - it is a property of
   * the frame, not of an individual match.
   */
  snapshot?: string
  /** Present on entries replayed from the hold window; the bbox may be stale. */
  held?: boolean
}

/**
 * WS alerts frames.
 *
 * Fires only when a camera's **set of detected classes** changes, not per
 * frame - confidence jitter alone sends nothing. So `detections: []` is the
 * all-clear, and a long silence means nothing changed rather than that the
 * feed died. A screen that expects periodic refreshes will conclude the
 * service is dead during a quiet afternoon.
 */
export type AlertFrame =
  | { type: 'snapshot'; cameras: Record<string, AlertDetection[]> }
  | { type: 'update'; camera: string; detections: AlertDetection[] }

/** One zone's occupancy inside an occupancy frame. */
export interface ZoneOccupancy {
  count: number
  /**
   * Positions that landed inside - floor centimetres for world zones, pixel
   * foot-points for pixel zones. A person can be in several overlapping zones
   * at once, and a boundary counts as inside, so counts may sum above the
   * number of people present.
   */
  points: Array<[number, number]>
}

/**
 * WS occupancy frames.
 *
 * Pushed only when a zone's count changes - there is no heartbeat, so an
 * unchanging count and a dead connection look identical from the payload
 * alone. The stream status badge is the thing that distinguishes them.
 */
export type OccupancyFrame =
  | { type: 'snapshot'; zones: Record<string, ZoneOccupancy> }
  | { type: 'update'; zone: string; count: number; points: Array<[number, number]> }

/** GET /api/attendance/today, and the check-in / check-out responses. */
export interface AttendanceRecord {
  id: string
  employee_id: string
  employee_name: string
  agency_id: string
  /** ISO 8601. */
  check_in: string
  /** null while the employee is still in the building. */
  check_out: string | null
  method: AttendanceMethod
}

/**
 * WS /ws/attendance
 *
 * The contract's example for this entry matches neither frame the backend
 * actually sends. Both real shapes come from attendance_to_dict(), which always
 * includes `id`; only the MQTT-triggered path adds `device_id`, taken from the
 * topic. The REST-triggered path (check-in / check-out endpoints) omits it.
 *
 * So `id` is optional here only because the contract says it is absent - in
 * practice it is always present. `device_id` is genuinely optional. The merge in
 * attendanceMerge.ts keys on neither, which is what makes it survive both.
 */
export interface AttendanceEvent {
  type: string
  event: string
  id?: string
  employee_id: string
  employee_name: string
  agency_id: string
  check_in: string
  check_out: string | null
  method: AttendanceMethod
  device_id?: string
}
