import { ROLES, type Role } from '@/api/types'

/**
 * The roles this dashboard will put on an account. ADMIN is not one of them.
 *
 * Nobody creates an admin here and nobody removes one - not a manager, not an
 * admin, not on their own account (2026-08-20). Admin is not a setting the
 * application administers; it is a fact about who owns the system, and it is
 * arranged where the system is installed.
 *
 * So the way in is closed as well as the way out. Locking the ADMIN rows while
 * leaving ADMIN in the dropdowns would have left one direction open, and a
 * promotion nobody could reverse from here is a worse trap than a demotion.
 *
 * The API is unchanged and still accepts both: POST /api/users takes role=ADMIN
 * and PATCH /api/users/{id}/access moves anybody anywhere. This is the product
 * rule, held by the screens, and an admin still has to be made somewhere -
 * backend/seed_dev.py, or the database.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((role) => role !== 'ADMIN')

/**
 * Which roles may reach which screen.
 *
 * A screen a role cannot use is NOT SHOWN to that role - not in the navigation,
 * and not by typing the URL. Asked for on 2026-08-20, and it reverses what this
 * codebase used to argue: screens were deliberately left reachable so that
 * meeting the refusal state taught you where the boundary was, on the grounds
 * that a missing nav item looks like a feature that was never built. The call
 * went the other way, so the comments that argued for it are gone too.
 *
 * The refusal states stay in the screens as a backstop. They are close to
 * unreachable now, but "close to" is not "never": a session whose role changed
 * under it, or a route added here without an entry, both still land on one, and
 * a 403 answered by a blank screen would be worse than one answered in words.
 *
 * KEYED ON THE PRIMARY DATA OF EACH SCREEN, which is not always the only data
 * it reads. Two screens fetch something their own visitors may not be allowed
 * to fetch, and both let that degrade rather than fail:
 *
 *   /presence  reads attendance (ADMIN, MANAGER, SECURITY), and also agencies
 *              and employees, which are ADMIN and MANAGER only. A SECURITY
 *              account gets the roster but no opening_time, so nobody is marked
 *              late - the screen works and is missing a column of meaning.
 *   /visitors  reads tickets (ADMIN, MANAGER, AGENT), and also agencies for the
 *              branch picker when registering someone. An AGENT gets the queue
 *              and an empty picker.
 *
 * Both are worth fixing properly one day - by scoping those two reads to the
 * caller's own agency in the backend rather than refusing them - and neither is
 * a reason to hide a screen that otherwise works.
 *
 * Roles transcribed from backend/app/api/*.py. mocks/roles.ts carries the same
 * table keyed by API path; they describe the same rules from the two ends and
 * have to move together.
 */
const ROUTE_ROLES: Record<string, readonly Role[]> = {
  '/presence': ['ADMIN', 'MANAGER', 'SECURITY'],
  '/employees': ['ADMIN', 'MANAGER'],
  '/agencies': ['ADMIN', 'MANAGER'],
  '/users': ['ADMIN'],
  '/visitors': ['ADMIN', 'MANAGER', 'AGENT'],
  /* No entry means every signed-in role. The four below read no role-guarded
     endpoint at all: climate and controls are still <ContractPending>, and
     occupancy and alerts read AI streams the backend proxies without a role
     check of their own. */
}

/** Every route in the shell, so the navigation and the guard cannot drift. */
export function canReach(role: Role | null | undefined, path: string): boolean {
  const allowed = ROUTE_ROLES[path]
  if (!allowed) return true
  if (!role) return false
  return allowed.includes(role)
}
