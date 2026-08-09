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

/** GET /api/auth/me, and the `user` object inside POST /api/auth/login. */
export interface User {
  id: string
  full_name: string
  email: string
  role: Role
  /** null for an ADMIN not scoped to one agency. */
  agency_id: string | null
  is_active: boolean
  /** Only on GET /api/users entries, where a user may link to one employee. */
  employee_id?: string
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
