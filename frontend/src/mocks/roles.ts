import { ApiError } from '@/api/errors'
import type { Role } from '@/api/types'
import { requestUser } from './currentUser'

/**
 * Who may call what, reproduced from the backend's route dependencies.
 *
 * The fixtures answered every registered endpoint to whoever asked, because
 * nothing in the mock layer knew who that was. Found by testing: signed in as
 * the MANAGER the fixtures hand out by default, the User accounts screen was
 * fully usable - table, role dropdowns, delete - when every route behind it is
 * ADMIN-only and would answer her with a 403. The screen already handles that
 * refusal; there was simply no way to reach it without a backend.
 *
 * That is the failure this layer is supposed to prevent. A fixture that allows
 * what the API forbids does not just mislead a tester, it lets a screen be
 * built against permissions that do not exist, and the gap only shows up on the
 * day it is pointed at a real server.
 *
 * The gate lives here rather than in each fixture for two reasons: a rule
 * written once cannot be forgotten on the next endpoint added, and reads and
 * writes go through the same table instead of two copies that drift.
 *
 * Transcribed from backend/app/api/*.py, one line per router:
 *
 *   users        ADMIN                                  (ADMIN_ONLY, users.py:20)
 *   agencies     ADMIN, MANAGER to read; ADMIN to write (agencies.py)
 *   employees    ADMIN, MANAGER                         (employees.py)
 *   attendance   ADMIN, MANAGER, SECURITY               (ATTENDANCE_ROLES)
 *   tickets      ADMIN, MANAGER, AGENT                  (TICKET_ROLES)
 *   visitors     ADMIN, MANAGER, AGENT, SECURITY        (VISITOR_ROLES)
 */

/**
 * The roles allowed to call this endpoint, or null when no rule applies.
 *
 * Matched on the router prefix rather than the full key so an endpoint added
 * later is covered by the rule its neighbours already carry. Null - and so
 * allowed - covers /api/auth, which is how a session begins and cannot require
 * one, and anything under a prefix nobody has written a rule for yet.
 */
export function rolesFor(key: string): Role[] | null {
  const [method, path] = key.split(' ')
  if (!path) return null

  if (path.startsWith('/api/users')) return ['ADMIN']

  if (path.startsWith('/api/agencies')) {
    /* The one split router. Reading is ADMIN and MANAGER, and a MANAGER's list
       comes back scoped (fixtures/agencies.ts). Creating and deleting are ADMIN
       alone. PUT allows a MANAGER on their OWN agency - the ownership half is
       not expressible here, so it is left to the route, and this only keeps out
       the roles that cannot edit any agency at all. */
    return method === 'GET' || method === 'PUT' ? ['ADMIN', 'MANAGER'] : ['ADMIN']
  }

  if (path.startsWith('/api/employees')) return ['ADMIN', 'MANAGER']
  if (path.startsWith('/api/attendance')) return ['ADMIN', 'MANAGER', 'SECURITY']
  if (path.startsWith('/api/tickets')) return ['ADMIN', 'MANAGER', 'AGENT']
  if (path.startsWith('/api/visitors')) return ['ADMIN', 'MANAGER', 'AGENT', 'SECURITY']

  return null
}

/**
 * Throws the 403 the backend would throw, or returns for an allowed call.
 *
 * An unknown caller is allowed through rather than refused. The alternative
 * would be a 401, which is what the real API answers, but nothing here can tell
 * "signed out" apart from "a test supplied a session without going through
 * tokenStore" - and refusing the second would fail suites over a detail of how
 * they render rather than over anything about the app.
 */
export function assertRoleAllowed(key: string): void {
  const allowed = rolesFor(key)
  if (allowed === null) return

  const user = requestUser()
  if (user === null) return

  if (!allowed.includes(user.role)) {
    /* The French detail and the status the backend's require_roles produces,
       so a screen handling this here handles the real one unchanged. */
    throw new ApiError('http', 'Acces refuse', 403)
  }
}
