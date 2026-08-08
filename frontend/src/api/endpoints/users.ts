import { fetchJson } from '../client'
import type { Role, UserAccount, UserCreate, UserUpdate } from '../types'

/**
 * User account endpoints. Every one of them is **ADMIN only** - the whole
 * router carries `Depends(require_roles(RoleName.ADMIN))`, so a MANAGER who can
 * administer employees still gets a 403 here.
 *
 * There are five routes rather than two because the backend refuses to let role
 * and agency ride along in a general update. Each has a side effect a plain PUT
 * would hide, so each keeps its own call:
 *
 *   PATCH /role    promoting to ADMIN also clears the account's agency.
 *   PATCH /agency  also moves the linked employee, so a login and the person it
 *                  belongs to can never end up in different agencies.
 *
 * Keeping them separate here means one screen action is one request. A
 * combined save would have to sequence three calls and could leave a user
 * half-updated when the second one fails.
 */

export function fetchUsers(signal?: AbortSignal): Promise<UserAccount[]> {
  return fetchJson<UserAccount[]>(
    { key: 'GET /api/users', path: '/api/users', auth: true },
    { signal },
  )
}

/**
 * Creates an account. `password` is required and min 8 - it is not in the
 * contract, because the documented payload there is the response.
 *
 * The agency rule is inverted from the obvious one: ADMIN must send no
 * agency_id (422 if it does), every other role must send one.
 */
export function createUser(body: UserCreate, signal?: AbortSignal): Promise<UserAccount> {
  return fetchJson<UserAccount>(
    { key: 'POST /api/users', path: '/api/users', method: 'POST', auth: true },
    { signal, body },
  )
}

/** Profile fields only. Role and agency have their own routes below. */
export function updateUser(
  id: string,
  body: UserUpdate,
  signal?: AbortSignal,
): Promise<UserAccount> {
  return fetchJson<UserAccount>(
    { key: 'PUT /api/users/{id}', path: `/api/users/${id}`, method: 'PUT', auth: true },
    { signal, body },
  )
}

/**
 * Changes the role, and clears the agency when the new role is ADMIN.
 *
 * One direction of this is a dead end in the current backend, and the UI has to
 * know it. update_user_role validates the *new* role against the account's
 * *existing* agency_id, so demoting an ADMIN - who by definition has none -
 * raises 422 "Une agence est obligatoire pour ce role". Assigning them an
 * agency first does not help either: update_user_agency validates against their
 * *current* role, which is still ADMIN, and refuses a non-null agency.
 *
 * So an ADMIN cannot be moved to any other role through the API at all. Neither
 * route is wrong on its own; together they have no ordering that works. This is
 * a backend issue to raise, not something the frontend can sequence around, and
 * the screen disables the control rather than offering an action that always
 * fails.
 */
export function updateUserRole(id: string, role: Role, signal?: AbortSignal): Promise<UserAccount> {
  return fetchJson<UserAccount>(
    {
      key: 'PATCH /api/users/{id}/role',
      path: `/api/users/${id}/role`,
      method: 'PATCH',
      auth: true,
    },
    { signal, body: { role } },
  )
}

/**
 * Moves the account to another agency - and moves its linked employee with it.
 *
 * That second half is the reason this is not a field on the update route: the
 * write touches a row the caller never named. It is also why the same role rule
 * applies here, checked against the role the account has now.
 */
export function updateUserAgency(
  id: string,
  agencyId: string | null,
  signal?: AbortSignal,
): Promise<UserAccount> {
  return fetchJson<UserAccount>(
    {
      key: 'PATCH /api/users/{id}/agency',
      path: `/api/users/${id}/agency`,
      method: 'PATCH',
      auth: true,
    },
    { signal, body: { agency_id: agencyId } },
  )
}

/**
 * Deletes the account. Returns 204 with no body.
 *
 * Unlike deleting an employee this destroys no attendance history - an employee
 * row survives its login being removed, and the card keeps working. An ADMIN
 * cannot delete their own account (400).
 */
export function deleteUser(id: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    { key: 'DELETE /api/users/{id}', path: `/api/users/${id}`, method: 'DELETE', auth: true },
    { signal },
  )
}
