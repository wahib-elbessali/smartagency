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
 * it reads. /visitors fetches something its own visitors may not be allowed to
 * fetch, and lets that degrade rather than fail: it reads tickets (ADMIN,
 * MANAGER, AGENT), and also agencies for the branch picker when registering
 * someone, and services for the service picker. An AGENT gets the queue and an
 * empty picker for anything scoped ADMIN/MANAGER-only.
 *
 * Worth fixing properly one day - by scoping that read to the caller's own
 * agency in the backend rather than refusing it - and not a reason to hide a
 * screen that otherwise works.
 *
 * /presence was the second of those and no longer is; see its entry, which is
 * the one place this table overrules a screen that works.
 *
 * /occupancy is a rule with nothing behind it yet. The AI stream it reads
 * (contracts/ai-service.md, WS /zoning/occupancy/stream) has no role check and
 * no agency_id on a zone - one physical site, not scoped per branch - so this
 * entry only decides who may look at the one feed that exists. An ADMIN or
 * MANAGER seeing "their own agency's zones" and nothing else needs zones to
 * carry an agency_id all the way from the AI service through the backend
 * proxy first; that's a contracts/backend/ai change, not one this file can
 * make on its own.
 *
 * Roles transcribed from backend/app/api/*.py. mocks/roles.ts carries the same
 * table keyed by API path; they describe the same rules from the two ends and
 * have to move together.
 *
 * ONE ENTRY IS DELIBERATELY STRICTER THAN THE API IT FRONTS: /presence, which
 * drops SECURITY. See it below. Everywhere else this table transcribes, and
 * mocks/roles.ts is right to keep answering a guard - it describes the API,
 * not the navigation.
 */
const ROUTE_ROLES: Record<string, readonly Role[]> = {
  /* Admins and managers only from 2026-09-09, though GET /api/attendance/*
     still takes SECURITY and scopes it to their own agency (attendance.py:26).

     THE ONE ENTRY HERE THAT OVERRULES WORKING CODE. The screen renders for a
     guard - roster, headcount, arrivals through the day - and only the late
     column drops out, because opening_time comes from agencies and that read
     is ADMIN/MANAGER. It was removed anyway, on the judgment that a guard's
     screens are alerts and manual controls and that who is on the payroll and
     when they arrive is not theirs to read. That is a product call, not a
     transcription, which is why it is written down rather than assumed.

     It costs them the "Record attendance" dialog with it. That dialog lives on
     this screen and nowhere else (EmployeePresence.tsx:250) while POST
     /api/attendance/check-in still takes SECURITY - so if badging someone in
     at the door turns out to be part of the job, the fix is to give that
     dialog its own route, not to widen this entry back out. */
  '/presence': ['ADMIN', 'MANAGER'],
  '/employees': ['ADMIN', 'MANAGER'],
  /* Briefly ADMIN-only on 2026-09-09, on the argument that a manager's list is
     a one-row list of the branch they are already in. Reverted the same day,
     because the branch page that was carrying their hours, counters and zones
     was itself removed later that day - which leaves this card the only place
     a manager can read any of it. A list of one is a poor menu and a fine
     summary; it is the summary that is wanted here. */
  '/agencies': ['ADMIN', 'MANAGER'],
  '/services': ['ADMIN', 'MANAGER'],
  '/devices': ['ADMIN', 'MANAGER', 'TECHNICIAN'],
  '/users': ['ADMIN'],
  '/visitors': ['ADMIN', 'MANAGER', 'AGENT'],
  '/occupancy': ['ADMIN', 'MANAGER'],
  /* Added 2026-09-09, and unlike /agencies above it this is not a product
     rule - it is the API's own rule, transcribed like every other line here.
     Climate is built entirely on GET /api/agencies, which is ADMIN and
     MANAGER, so the three roles that used to find it in the nav were being
     offered a refusal message and never weather.

     The request was "not the agent" and it went wider on purpose. Security
     and the technician are different jobs from an agent - a guard watches the
     camera stream, a technician registers devices - but the reason they lose
     this screen is not their job description, it is that they meet the same
     403, and hiding a screen that can only answer 403 costs nothing.

     Delete this entry rather than narrow it further once GET /api/agencies is
     scoped to the caller's own agency in the backend - the same fix /presence
     and /visitors are waiting on above. The technician has the best claim to
     it back: the DHT22 and MQ-7 are theirs. What this screen shows today is
     Open-Meteo's outside weather, not those sensors, which is why that claim
     is not yet a reason to keep them here. */
  '/climate': ['ADMIN', 'MANAGER'],
  /* No entry means every signed-in role, and /alerts and /controls are the
     only two left with no entry: controls is still <ContractPending>, and
     alerts reads an AI stream the backend proxies without a role check of its
     own. /climate used to be a third, which is what this note undercounted -
     it reads agencies like the screens above it and now says so. */
}

/**
 * Every route in the shell, so the navigation and the guard cannot drift.
 *
 * ROUTE_ROLES is keyed on the top-level paths in SCREENS, all of which are
 * static - but /agencies/{id} (the agency detail screen) is not, and an exact
 * lookup on a path carrying a real id would never match its entry, silently
 * treating it as unguarded (`!allowed` returns true). A nested path inherits
 * its parent's rule instead, so a route added under an existing one is closed
 * by default rather than open by default.
 *
 * Every route in SCREENS is static again as of 2026-09-09 - /agencies/{id} was
 * the only dynamic one and its screen is gone - so nothing relies on the
 * fallback today. It stays because the next nested route should inherit rather
 * than arrive unguarded, which is the failure this paragraph exists to prevent.
 */
export function canReach(role: Role | null | undefined, path: string): boolean {
  const base = `/${path.split('/')[1] ?? ''}`
  const allowed = ROUTE_ROLES[path] ?? ROUTE_ROLES[base]
  if (!allowed) return true
  if (!role) return false
  return allowed.includes(role)
}
