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
 * A service point serves one visitor at a time (`COUNTER`) or handles work
 * that does not (`OFFICE`, e.g. a back-office loan review). Enforced by
 * backend/app/schemas/service.py's `PointType` literal, not a database enum -
 * still exact, since nothing else assigns the column.
 */
export const POINT_TYPES = ['COUNTER', 'OFFICE'] as const
export type PointType = (typeof POINT_TYPES)[number]

/** Enforced by the `devices.status` Enum column. */
export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'ERROR', 'MAINTENANCE'] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

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

/**
 * Nested in AgencyResponse, from backend/app/schemas/agency.py's
 * `CounterResponse`. Added by the services contract update (2026-08-27):
 * `service_id` and `point_type` did not exist before it.
 */
export interface Counter {
  id: string
  number: number
  name: string | null
  point_type: PointType
  is_open: boolean
  /** null until PATCH /api/counters/{id}/service assigns one. */
  service_id: string | null
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

/**
 * POST /api/agencies — nested counter. `number` must be unique per agency.
 * `point_type` defaults to `COUNTER` server-side when omitted.
 */
export interface CounterCreate {
  number: number
  name?: string | null
  point_type?: PointType
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
 * GET|POST /api/agencies/{agency_id}/services and GET|PUT /api/services/{id},
 * from ServiceResponse. What a visitor's ticket is actually for - "Virement",
 * "Ouverture de compte" - and the unit a counter is assigned to serve.
 */
export interface Service {
  id: string
  agency_id: string
  /** Unique per agency, not globally. Normalized upper-case server-side. */
  code: string
  name: string
  description: string | null
  point_type: PointType
  /** How many open points are needed before the service is considered staffed. */
  min_points: number
  is_active: boolean
}

/**
 * POST /api/agencies/{agency_id}/services — from ServiceCreate.
 * `point_type` and `min_points` default server-side (`COUNTER`, `1`); `is_active`
 * defaults to `true`.
 */
export interface ServiceCreate {
  code: string
  name: string
  description?: string | null
  point_type?: PointType
  min_points?: number
  is_active?: boolean
}

/** PUT /api/services/{id} — from ServiceUpdate. All fields optional, exclude_unset. */
export type ServiceUpdate = Partial<ServiceCreate>

/**
 * GET /api/services/{id}/points — from ServicePointResponse. The same row as
 * `Counter`, but flattened with its own `agency_id` rather than inherited from
 * a parent Agency object, because this list is not nested under one.
 */
export interface ServicePoint {
  id: string
  agency_id: string
  service_id: string | null
  number: number
  name: string | null
  point_type: PointType
  is_open: boolean
}

/**
 * PATCH /api/counters/{counter_id}/service — from CounterServiceAssignment.
 * `service_id: null` clears the assignment and resets the counter's
 * `point_type` back to `COUNTER` server-side.
 */
export interface CounterServiceAssignment {
  service_id: string | null
}

/**
 * GET /api/agents/me/assignment, and the `assignment` inside each
 * GET /api/agencies/{id}/agents row - contracts/api.md §5. Which guichet or
 * bureau a MANAGER has put an AGENT on. Only reported while that point has an
 * active service; `null` when the agent has no assignment.
 */
export interface AgentAssignment {
  counter_id: string
  counter_name: string | null
  service_id: string
  service_name: string
}

/**
 * One row of GET /api/agencies/{agency_id}/agents - contracts/api.md §5.
 * Every AGENT account in the agency with its current assignment, or null.
 * Deliberately narrower than GET /api/users, which stays ADMIN-only.
 */
export interface AgentSummary {
  user_id: string
  full_name: string
  assignment: AgentAssignment | null
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
 *
 * `service_id`/`service_code`/`service_name` were added alongside the Services
 * contract (2026-08-27) and are nullable because a ticket predates them or its
 * service was deleted after the fact - `service.py`'s relationship has no
 * cascade rule that forbids that. `service_type` survives independently: the
 * backend still stores it as free text on the ticket (defaulting to the
 * service's name if the caller sends none), so it is not simply `service_name`
 * under another key.
 */
export interface Ticket {
  id: string
  visitor_id: string
  visitor_name: string
  agency_id: string
  service_id: string | null
  service_code: string | null
  service_name: string | null
  /** null until the ticket is called to a counter. */
  counter_id: string | null
  /** "YYYYMMDD-SERVICE_CODE-001", numbered per agency, service and day. */
  ticket_number: string
  service_type: string | null
  status: TicketStatus
  /** ISO 8601. */
  created_at: string
  called_at: string | null
  completed_at: string | null
  /**
   * contracts/api.md §8. Null until the ticket is completed with a note, and
   * set only by POST /api/tickets/{id}/complete. At most 2,000 characters,
   * trimmed; a blank note is stored as null.
   */
  notes: string | null
}

/**
 * POST /api/tickets — from TicketCreate. The visitor must already exist, and
 * `service_id` must reference a service in the visitor's own agency.
 * `service_type` is optional free text; the backend falls back to the
 * service's `name` when it is omitted.
 */
export interface TicketCreate {
  visitor_id: string
  service_id: string
  service_type?: string | null
}

/** POST /api/tickets/{id}/call — from TicketCallRequest. */
export interface TicketCall {
  counter_id: string
}

/**
 * GET|POST /api/devices and GET|PUT /api/devices/{id}, from DeviceResponse.
 * ADMIN, MANAGER and TECHNICIAN only - contracts/api.md §9, added 2026-08-27.
 */
export interface Device {
  id: string
  agency_id: string
  name: string
  /** Free text, upper-cased server-side (e.g. "DHT22"). No enum backs it. */
  device_type: string
  mqtt_client_id: string
  mqtt_topic: string
  status: DeviceStatus
  /** ISO 8601. null until the device has ever published. */
  last_seen_at: string | null
}

/**
 * POST /api/devices/agencies/{agency_id} — from DeviceCreate. `mqtt_topic`
 * defaults server-side to `agency/{agency_id}/device/{mqtt_client_id}/sensor`
 * when omitted, matching the MQTT consumer's subscription pattern.
 */
export interface DeviceCreate {
  name: string
  device_type: string
  mqtt_client_id: string
  mqtt_topic?: string | null
}

/** PUT /api/devices/{id} — from DeviceUpdate. All fields optional, exclude_unset. */
export interface DeviceUpdate {
  name?: string
  device_type?: string
  mqtt_client_id?: string
  mqtt_topic?: string | null
  status?: DeviceStatus
}

/**
 * POST /api/devices/agencies/{id} and POST /api/devices/{id}/rotate-key.
 *
 * `device_key` is the plaintext secret and is returned ONLY here - the backend
 * stores just its hash (`device_key_hash`) and every other response omits it.
 * There is no route to recover a lost key, only to rotate it and invalidate
 * the old one, so the UI has exactly one chance to show this value.
 */
export interface DeviceRegistration extends Device {
  device_key: string
}

/**
 * GET /api/devices/{id}/thresholds and the two write routes, from
 * SensorThresholdResponse. `sensor_type` is free text lower-cased server-side
 * (e.g. "temperature"), not an enum - a device can report sensors this
 * dashboard has never named.
 */
export interface SensorThreshold {
  id: string
  device_id: string
  sensor_type: string
  unit: string | null
  warning_max: number | null
  critical_max: number | null
  is_active: boolean
}

/**
 * PUT /api/devices/{id}/thresholds/{sensor_type} — from SensorThresholdUpsert.
 * Creates the threshold if none exists for that sensor yet, otherwise replaces
 * it - there is no separate POST. At least one of `warning_max` /
 * `critical_max` is required, and `warning_max` must not exceed `critical_max`;
 * both are 422 refusals the server enforces, not this type.
 */
export interface SensorThresholdUpsert {
  unit?: string | null
  warning_max?: number | null
  critical_max?: number | null
  is_active?: boolean
}

/**
 * GET|POST /api/agencies/{agency_id}/cameras and PUT /api/cameras/{id}, from
 * CameraResponse in backend/app/schemas/camera.py. contracts/api.md §11,
 * added 2026-09-12. ADMIN, MANAGER and SECURITY; delete drops SECURITY.
 *
 * `name` is not a display label - it is the exact source identifier the AI
 * service knows the camera by, which is why it is unique across every branch
 * and not just within one (the AI source registry is site-wide). The names on
 * the Alerts screen come from that same registry, so a camera renamed here
 * stops matching its own detections until the backend re-syncs.
 *
 * `status` reuses the device enum, but only two of its values are ever written
 * for a camera: OFFLINE from creation until the backend receives its first
 * detection stream event, then ONLINE. Nothing sets ERROR or MAINTENANCE on a
 * camera today.
 */
export interface Camera {
  id: string
  agency_id: string
  name: string
  /**
   * An RTSP address, typically - which a browser cannot play, so it is shown
   * and edited here but never embedded. The schema allows null on the way out;
   * the create/update routes refuse it blank.
   */
  stream_url: string | null
  status: DeviceStatus
}

/** POST /api/agencies/{agency_id}/cameras — from CameraCreate. Both required. */
export interface CameraCreate {
  name: string
  stream_url: string
}

/** PUT /api/cameras/{id} — from CameraUpdate. Both optional, exclude_unset. */
export interface CameraUpdate {
  name?: string
  stream_url?: string
}

/**
 * GET|PUT /api/ai-alerts/thresholds/weapon, from AIWeaponThresholdResponse.
 * contracts/api.md §12, added 2026-09-12. ADMIN, MANAGER and SECURITY.
 *
 * One global number, not per camera or per agency: the minimum confidence a
 * weapon detection needs before the backend turns it into an alert. Strictly
 * greater than 0 and at most 1, enforced server-side (422). It is separate
 * from the AI model's own `conf` cutoff - the model still reports everything
 * above its own bar, and this decides which of those anyone hears about.
 */
export interface WeaponThreshold {
  confidence: number
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
  | AlertStateFrame

/** AlertSeverity / AlertStatus in backend/app/models/entities.py. */
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

/**
 * A stored business alert - GET /api/agencies/{agency_id}/alerts, from
 * AlertResponse. contracts/api.md §14, added in #112. ADMIN any agency,
 * MANAGER and SECURITY their own.
 *
 * Not the same thing as a live detection. The backend turns a detection into
 * one of these only when it clears the weapon threshold, and resolves it when
 * the camera clears; the live frames above report everything the model sees.
 * `camera_id` and `camera_name` are null once the camera has been deleted.
 * The model also has `title` and `message`, but the response leaves them out.
 */
export interface StoredAlert {
  id: string
  agency_id: string
  camera_id: string | null
  camera_name: string | null
  alert_type: string
  severity: AlertSeverity
  status: AlertStatus
  created_at: string
  resolved_at: string | null
}

/**
 * The weapon socket also pushes a stored alert's new state once the database
 * commit has gone through: the whole record, plus which change it was.
 * Filtered by agency and camera before delivery, like the detections.
 */
export interface AlertStateFrame extends StoredAlert {
  type: 'alert_state'
  event: 'created' | 'updated' | 'resolved'
}

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
  /**
   * contracts/api.md §13. Always true for a pixel zone. For a world zone it
   * says whether person tracking is running - and while it is `false`, a
   * `count` of 0 means "not tracking yet", NOT a confirmed empty zone. The
   * contract says so in as many words; a screen must not render that 0 as
   * a number.
   */
  people_tracking_ready: boolean
}

/**
 * WS /ws/occupancy frames - contracts/api.md §13.
 *
 * Pushed only when a zone's count crosses the threshold or its readiness
 * flips - there is no heartbeat, so an unchanging count and a dead connection
 * look identical from the payload alone. The stream status badge is the
 * thing that distinguishes them.
 */
export type OccupancyFrame =
  | { type: 'snapshot'; zones: Record<string, ZoneOccupancy> }
  | ({ type: 'update'; zone: string } & ZoneOccupancy)

/**
 * A drawn detection zone - the AI service's /zoning store, reached through
 * backend/app/api/ai_zoning.py (PR #109, 2026-09-23). No contracts/api.md
 * entry yet; every field below is the AI service's own
 * (contracts/ai-service.md §/zoning), which the gateway passes through
 * unchanged.
 *
 * NOT THE SAME THING AS `Zone` ABOVE, and the collision is the API's, not
 * this file's. `Zone` is a room in a branch (`Accueil`, `Bureau · private`)
 * from backend/app/schemas/agency.py, created with the agency and carrying
 * `zone_type` / `is_private`. THIS is a polygon somebody drew over a camera
 * picture so the detector counts the people standing inside it, and it lives
 * in the AI service's own store, not in our database. Nothing links the two.
 * Named `CameraZone` here so no screen can confuse them by accident.
 *
 * CAMERAS ARE NAMED, NOT ID'D. Backend registers each camera row with the AI
 * service under `Camera.name` (app/services/ai_camera_sync.py), so every
 * `camera` below and every key of `sources` is one of our camera NAMES.
 *
 * `name` is the primary key - the AI service stores zones in a flat
 * name-keyed map, and re-posting a name OVERWRITES that zone, mode included.
 * There is no id.
 */
export type CameraZoneMode = 'pixel' | 'world'

/**
 * One value of GET /api/agencies/{agency_id}/ai/zones, which answers the AI
 * service's name-keyed map as-is: `{ "till": { ... }, "lobby": { ... } }`.
 *
 * The gateway checks the caller may read that agency and then returns the
 * WHOLE site's map - it does not filter by agency. So a screen keeps only the
 * zones whose camera is one of the agency's own camera names.
 */
export interface CameraZoneEntry {
  /**
   * Inferred by the AI service from how many cameras the zone was saved
   * with: one is `pixel` (that camera's own raw detections, no calibration),
   * two or more is `world` (the drawn-on camera calibrated AND aligned).
   */
  mode: CameraZoneMode
  /** `pixel` zones: the camera name it was drawn on. */
  camera?: string
  /** `pixel` zones: the polygon in that camera's own frame pixels. */
  polygon_px?: Array<[number, number]>
  /** `world` zones: the polygon on the shared floor plane, centimetres. */
  polygon_m?: Array<[number, number]>
  /** `world` zones: the camera and pixel outline it was drawn as. */
  converted_from?: { camera: string; polygon_px: Array<[number, number]> }
}

/**
 * One zone as screens use it - an entry of that map with its key folded in,
 * and the drawn-on camera read from wherever the zone's mode keeps it. The
 * fold happens in api/endpoints/zones.ts and nowhere else.
 */
export interface CameraZone {
  name: string
  mode: CameraZoneMode
  /** The camera name it was drawn on; null for a world zone with no record of one. */
  camera: string | null
  /** The outline in `camera`'s frame pixels - what gets redrawn on its picture. */
  polygon_px: Array<[number, number]> | null
  polygon_m: Array<[number, number]> | null
}

/**
 * POST /api/agencies/{agency_id}/ai/zones - from ZoneCreateRequest
 * (backend/app/schemas/ai_zoning.py).
 *
 *   { "name": "lobby", "camera": "cam-lobby",
 *     "polygon": [[120, 430], [980, 410], [1010, 700], [95, 720]],
 *     "sources": { "cam-lobby": "rtsp://..." } }
 *
 * `camera` must be one of the `sources` keys (422 otherwise). The URLs in
 * `sources` must be non-blank but are then REPLACED by the gateway with the
 * stream URLs our database holds, so the browser cannot point the detector at
 * an arbitrary address; sending the camera row's own `stream_url` is what the
 * gateway's comment calls convenience. One source means `pixel` mode, the
 * only mode this dashboard creates.
 */
export interface CameraZoneCreate {
  name: string
  camera: string
  polygon: Array<[number, number]>
  sources: Record<string, string>
}

/**
 * What that POST answers - the AI service's own response, passed through.
 *
 * `warnings` must be SHOWN. The AI service uses it to say things like
 * "'/people' is not currently running … this zone will count 0 until it is",
 * a configuration mistake that is otherwise indistinguishable from an empty
 * room. Empty for a pixel zone on a healthy service, the normal case here.
 */
export interface CameraZoneSaved {
  name: string
  mode: CameraZoneMode
  /** Where the AI service wrote the zone file. A server path, not for display. */
  saved: string
  sources_known: string[]
  warnings: string[]
}

/**
 * Workstations - backend/app/api/employee_activity.py (PR #109), a table of
 * our own in front of the AI service's /employee_activity
 * (contracts/ai-service.md). Not in contracts/api.md yet; every field is
 * from WorkstationResponse in backend/app/schemas/employee_activity.py.
 *
 * A name bound to a zone somebody drew (`CameraZone` above), which the AI
 * service turns into "is anybody at this counter?" - built entirely on
 * /zoning's already-computed occupancy: no face recognition, no model of its
 * own, nothing about WHO is there. It answers whether the chair is filled.
 * The employee on the row is who is SUPPOSED to be there, set by a manager;
 * the detector never checks it.
 *
 * NOT ATTENDANCE, and the difference is the point. `AttendanceRecord` is a
 * badge at the door - who came to work today, from the RFID reader. This is
 * whether counter 3 is being manned at 14:40 while twelve people wait.
 *
 * `name` is the key, unique across the whole site: backend answers 409 for a
 * name another agency already uses.
 */
export const WORKSTATION_STATUSES = ['unknown', 'present', 'away'] as const
export type WorkstationStatus = (typeof WORKSTATION_STATUSES)[number]

/**
 * What the AI service knows about one workstation - the rows of its GET and
 * of WS /ws/employee-activity, which the backend relays untouched
 * (contracts/ai-service.md §/employee_activity).
 */
export interface WorkstationState {
  name: string
  /** The `CameraZone.name` this watches. The zone must exist first. */
  zone: string
  /**
   * `present` fires on ANY sighting in the zone. `away` only after the zone
   * has been continuously empty for the service's absence window
   * (`employee_activity.absence_seconds`, 300s by default) - so a step away
   * to the printer does not read as "not working", and a screen must not
   * present `away` as if it were instant.
   *
   * `unknown` is not a third kind of absence: it means not classified yet.
   */
  status: WorkstationStatus
  /**
   * When the current status began - epoch SECONDS, float, not an ISO string
   * and not milliseconds. Converted at the edge (in the screen) rather than
   * pretending otherwise.
   */
  since: number
  /**
   * `false` means "not measured yet" and is DISTINCT from a measured empty
   * zone - a workstation whose camera has never produced a frame sits at
   * `unknown` with `zone_known: false`, and that is a configuration problem,
   * not a quiet counter.
   */
  zone_known: boolean
}

/**
 * GET /api/agencies/{agency_id}/workstations - WorkstationResponse. Our row
 * (name, zone, employee) wearing the AI service's current state for it.
 */
export interface Workstation extends Omit<WorkstationState, 'since'> {
  employee_id: string | null
  /** "First Last", built by backend from the employee row. */
  employee_name: string | null
  /** Null when the AI service has no state for this name (it is down, or lost it). */
  since: number | null
}

/**
 * POST /api/agencies/{agency_id}/workstations - WorkstationCreate.
 *
 *   { "name": "guichet-3", "zone": "counters", "employee_id": null }
 *
 * 422 when the zone does not exist in the AI service yet, or the employee
 * belongs to another agency; 404 for an unknown employee. Re-posting a name
 * this agency already has REBINDS it (zone and employee both replaced).
 */
export interface WorkstationCreate {
  name: string
  zone: string
  employee_id?: string | null
}

/**
 * WS /ws/employee-activity frames - the AI service's own, relayed as-is.
 *
 * A snapshot of every workstation ON THE SITE on connect, then one frame each
 * time a status ACTUALLY FLIPS - not per poll. So silence means nothing
 * changed, and the connection badge is the only thing separating "steady"
 * from "dead". The stream is not filtered by agency and carries no employee.
 */
export type WorkstationFrame =
  { type: 'snapshot'; workstations: WorkstationState[] } | ({ type: 'update' } & WorkstationState)

/**
 * Camera calibration - backend/app/api/ai_calibration.py (PR #109), the
 * gateway in front of contracts/ai-service.md §/calibration. Not in
 * contracts/api.md yet; bodies are from backend/app/schemas/ai_calibration.py
 * and responses are the AI service's, passed through.
 *
 * The one-time per-site geometry every multi-camera feature sits on:
 * world-mode zones, person tracking, anything that needs a real floor
 * position rather than one camera's pixels.
 *
 * Cameras are named here, as everywhere on the AI side: every camera key
 * below is a `Camera.name`, the name backend registered it with the AI
 * service under.
 *
 * TWO FIELD NAMES BELOW COME FROM THE AI SOURCE, NOT THE CONTRACT, because
 * the contract's example for /calibration/align disagrees with what
 * ai/features/calibration/engine.py actually emits. Both are flagged for
 * the contract's owner; neither is invented here:
 *
 *   - The warning key is `reference_warning` (engine.py:581), not
 *     `results_warning` as the contract's example shows. Both are accepted
 *     below, because dropping a warning silently is the failure that costs
 *     something.
 *   - `fit` ("homography" | "affine" | "similarity") is written into the
 *     camera's stored diagnostics (engine.py:547), NOT into the per-camera
 *     entry of the align response the contract shows it in. So it is read
 *     from the diagnostics, where it exists.
 */

/**
 * What a calibrated camera knows about itself.
 *
 * Every field is one the AI service writes into `diag`
 * (ai/features/calibration/engine.py), surfaced through GET /calibration.
 * All optional: a camera calibrated before alignment carries only the
 * rectangle's own numbers, and gains the rest when it is aligned.
 */
export interface CalibrationDiagnostics {
  n_points?: number
  /**
   * DO NOT PRESENT AS ACCURACY. A 4-point fit is exact by construction, so
   * this is ~0 whether or not the clicked shape was really a right angle.
   * The contract says so in as many words. It says the maths ran, nothing
   * more, and a screen that shows it as a score teaches people to trust a
   * calibration that may be badly wrong.
   */
  px_err_mean?: number
  px_err_max?: number
  /** Free text; starts with "fallback" when the geometry was too degenerate. */
  aspect_source?: string
  inferred_aspect?: number
  aspect_stability_std?: number
  /** False means the rectangle's true shape was GUESSED as square. */
  aspect_confident?: boolean
  /** [w, h] the homography's pixel side is expressed in. */
  calib_res?: [number, number]
  aligned?: boolean
  aligned_to?: string
  aligned_with_n_points?: number
  /** Which transform the shared-point count supported. */
  fit?: string
  /** True when a >=4-point align replaced this camera's own rectangle. */
  aspect_superseded?: boolean
  note?: string
}

/**
 * One value of GET /api/agencies/{agency_id}/ai/calibration, which answers
 * the AI service's camera-name-keyed map, cut down by the gateway to this
 * agency's own camera names: `{ "cam-lobby": { "Hinv": [...], ... } }`.
 */
export interface CalibrationEntry {
  /**
   * Image pixels -> floor coordinates, 3x3 row-major. Read in the browser for
   * the checks a person makes while clicking - a shared line's straightness,
   * where saved gates sit on a camera, the bird's-eye overlay - never to
   * solve anything; the AI service does that (screens/homography.ts).
   */
  Hinv: number[][]
  diagnostics: CalibrationDiagnostics
}

/**
 * One calibrated camera as the screen uses it - an entry of that map with
 * its key folded in (api/endpoints/calibration.ts). Whether it is aligned is
 * `diagnostics.aligned`; there is no separate flag.
 */
export interface CameraCalibration {
  /** The camera NAME. */
  camera: string
  Hinv: number[][]
  diagnostics: CalibrationDiagnostics
}

/**
 * POST /api/agencies/{agency_id}/ai/calibration/rect - CalibrationRectRequest.
 * Exactly 4 points, in order around a shape that is a right angle in real
 * life; 404 for a camera name not in this agency, 422 for one without a
 * stream URL or for points the solve cannot use.
 *
 * `img_w` / `img_h` are REQUIRED by the service: the orthogonality solve
 * needs the image centre as an assumed principal point, and they are
 * recorded as `calib_res` so the calibration can be rescaled if the frame
 * size ever changes. They must be the size of THE FRAME THE POINTS WERE
 * CLICKED ON - the gateway's frame is the detector-scaled one, and that is
 * fine as long as these describe it.
 */
export interface CalibrationRectRequest {
  camera: string
  points: Array<[number, number]>
  img_w: number
  img_h: number
}

/** The rect response is the diagnostics, plus whether it is aligned yet. */
export interface CalibrationRectResult extends CalibrationDiagnostics {
  aligned: boolean
}

/**
 * POST /api/agencies/{agency_id}/ai/calibration/align - the FULL accumulated
 * list of shared-point observations, not a delta. One entry per real point,
 * naming the cameras it was clicked in: `{ "cam-lobby": [x, y],
 * "cam-counter": [x, y] }`. Every name must be a camera of this agency (404).
 */
export type SharedPoint = Record<string, [number, number]>

export interface AlignCameraResult {
  aligned: boolean
  reference: boolean
  n_points: number | null
  /** Which camera it was chained through, null for the reference. */
  via: string | null
  /** Present when the point order fit better reversed - worth surfacing. */
  order_reversed?: boolean
  /** Present, and the whole story, when `aligned` is false. */
  error?: string
}

export interface AlignResult {
  /** The camera every other one was aligned to. */
  reference: string
  results: Record<string, AlignCameraResult>
  /** See the note at the top: the service emits `reference_warning`. */
  reference_warning?: string | null
  results_warning?: string | null
  /** Cameras aligned on fewer than 4 shared points keep their own aspect. */
  weak_fits?: string | null
  /** How far apart the cameras now place each recorded point. */
  residual_checks: Array<{
    pairs: Array<{ cam_a: string; cam_b: string; distance_cm: number }>
  }>
}

/**
 * POST /api/agencies/{agency_id}/ai/calibration/cross-check - the AI
 * service's /calibration/cross_check, passed through by
 * backend/app/api/ai_calibration.py (CalibrationCrossCheckRequest: a
 * camera-name -> [px, py] map, 2 or more). Read-only: nothing is saved.
 *
 * `worlds` is where each camera puts the clicked spot on the shared floor,
 * `pairs` how far apart each two of them put it. For a correct alignment the
 * distances are small - it is the same physical point. 422 when any camera
 * named is uncalibrated or not yet aligned.
 */
export interface CrossCheckResult {
  worlds: Record<string, [number, number]>
  pairs: Array<{ cam_a: string; cam_b: string; distance_cm: number }>
}

/**
 * POST .../ai/calibration/gates - CalibrationGatesRequest. Entry/exit gates
 * as PIXEL clicks, per camera; the AI service converts them to floor
 * coordinates through that camera's current Hinv. The list REPLACES every
 * gate on the site, so a screen resends all of them each time.
 */
export interface CalibrationGatesRequest {
  gates: Array<{ camera: string; points: Array<[number, number]> }>
}

/**
 * GET .../ai/calibration/gates answers `{ gates }` in floor coordinates; the
 * POST and DELETE add how many and where the AI service wrote them.
 */
export interface CalibrationGates {
  gates: Array<[number, number]>
}

export interface CalibrationGatesSaved extends CalibrationGates {
  n: number
  /** A server path, not for display. */
  saved: string
}

/**
 * One person on the wanted watchlist - WantedPersonResponse,
 * backend/app/schemas/wanted.py (PR #109). Not in contracts/api.md yet.
 *
 * The backend keeps its own row per person, owned by one agency, in front of
 * the AI service's gallery (contracts/ai-service.md §/wanted). The gallery is
 * a SEPARATE store from employee face enrollment on purpose, so a staff
 * member and a wanted person can never be confused. No photo ever comes
 * back: `embeddings_count` is how many photos are enrolled for the name.
 */
export interface WantedPerson {
  id: string
  agency_id: string
  /** 1-80 characters of letters, digits, space and . _ + - ; unique site-wide. */
  name: string
  embeddings_count: number
  /** ISO 8601. */
  created_at: string
}

/** DELETE /api/ai/watchlist/{name} - WantedDeleteResponse. */
export interface WantedDeleted {
  name: string
  agency_id: string
  /** Every photo for the name goes; there is no removing one photo. */
  embeddings_removed: number
}

/**
 * GET|PUT /api/ai/watchlist/threshold - WantedThresholdResponse.
 *
 * `threshold` is a cosine similarity in [floor, 1], NOT a probability: the
 * score a face must reach against a watchlist photo to raise an alert.
 * Changes apply on the AI service's next detection cycle
 * (`applies_within_seconds`), and the AI service does not keep them across a
 * restart - `startup_default` is what it falls back to.
 */
export interface WantedThreshold {
  threshold: number
  /** Faces smaller than this many pixels are not matched at all. */
  min_face_px: number
  startup_default: { threshold: number; min_face_px: number }
  /** The lowest threshold the service accepts. */
  floor: number
  watchlist_size: number
  embeddings_total: number
  applies_within_seconds: number
  /** PUT only: the values it replaced. */
  previous?: { threshold: number; min_face_px: number } | null
  /** PUT only: e.g. that a threshold below the default raises false accusations. */
  warnings: string[]
}

/** PUT /api/ai/watchlist/threshold - WantedThresholdUpdate; at least one. */
export interface WantedThresholdUpdate {
  threshold?: number
  min_face_px?: number
}

/**
 * An employee's enrolled face - EmployeeFaceResponse,
 * backend/app/schemas/face_recognition.py (PR #109). Not in contracts/api.md
 * yet. GET /api/employees/faces lists only employees who ARE enrolled; POST
 * /api/employees/{id}/face answers the same shape.
 *
 * Enrollment is keyed to the EMPLOYEE, not to a typed name: the backend
 * registers the photo with the AI service under the employee's id. No photo
 * or embedding ever comes back - `embeddings_count` is how many photos are
 * enrolled, and enrolling again ADDS one.
 */
export interface EmployeeFace {
  employee_id: string
  /** "First Last", built by the backend. */
  employee_name: string
  agency_id: string
  enrolled: boolean
  embeddings_count: number
}

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
 * POST /api/attendance/check-in and /check-out — the request body.
 *
 * The employee is identified by RFID, NOT by id. That is the contract's choice
 * and it is not an oversight: these routes exist to record what a badge reader
 * would have recorded, so they take the same key the reader emits. An employee
 * without a card cannot be checked in through this route at all.
 *
 * `agency_id` is accepted by the schema and has NO effect - the contract says
 * so explicitly for both routes. It is typed here because sending it is legal,
 * but nothing in this codebase should bother.
 */
export interface AttendanceMark {
  employee_rfid: string
  /** ISO 8601. Optional; the server uses the current time when omitted. */
  timestamp?: string | null
  agency_id?: string | null
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
