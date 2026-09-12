import { describe, expect, it } from 'vitest'
import { canReach } from './access'
import { landingPathFor } from './landing'
import { ROLES } from '@/api/types'

/**
 * The table itself, tested apart from any screen.
 *
 * It decides two things that must never disagree - what the navigation offers
 * and what a typed URL allows - so it is worth pinning on its own rather than
 * inferring it from whichever component happens to render.
 */
describe('canReach', () => {
  it('keeps user accounts to admins', () => {
    expect(canReach('ADMIN', '/users')).toBe(true)
    for (const role of ROLES.filter((r) => r !== 'ADMIN')) {
      expect(canReach(role, '/users')).toBe(false)
    }
  })

  it('gives agencies and employees to admins and managers only', () => {
    for (const path of ['/agencies', '/employees']) {
      expect(canReach('ADMIN', path)).toBe(true)
      expect(canReach('MANAGER', path)).toBe(true)
      expect(canReach('AGENT', path)).toBe(false)
      expect(canReach('SECURITY', path)).toBe(false)
      expect(canReach('TECHNICIAN', path)).toBe(false)
    }
  })

  /* No screen sits under another one today - /agencies/{id} was the last and
     its screen is gone (2026-09-09) - so this pins the fallback rather than a
     live route: a nested path added later inherits, instead of matching
     nothing and being treated as unguarded. */
  it('inherits the parent rule for a nested path', () => {
    expect(canReach('ADMIN', '/users/u1000000-0000-4000-8000-000000000001')).toBe(true)
    expect(canReach('MANAGER', '/users/u1000000-0000-4000-8000-000000000001')).toBe(false)
  })

  /* GET /api/attendance/* still takes SECURITY; this screen does not, which
     is the one place the table is narrower than the API on purpose rather
     than because the screen would break (2026-09-09). */
  it('keeps presence to admins and managers', () => {
    expect(canReach('ADMIN', '/presence')).toBe(true)
    expect(canReach('MANAGER', '/presence')).toBe(true)
    for (const role of ['AGENT', 'SECURITY', 'TECHNICIAN'] as const) {
      expect(canReach(role, '/presence')).toBe(false)
    }
  })

  /* No role-guarded endpoint behind these, so no role is kept out. One is
     still <ContractPending>, which is a different thing from forbidden. */
  it('offers the unguarded screens to everyone', () => {
    for (const role of ROLES) {
      for (const path of ['/alerts', '/controls']) {
        expect(canReach(role, path)).toBe(true)
      }
    }
  })

  /* Both read what only an admin or a manager may read, so the table says
     what the API says and nobody else is offered either (2026-09-09). */
  it('keeps services and climate to admins and managers', () => {
    for (const path of ['/services', '/climate']) {
      expect(canReach('ADMIN', path)).toBe(true)
      expect(canReach('MANAGER', path)).toBe(true)
      for (const role of ['AGENT', 'SECURITY', 'TECHNICIAN'] as const) {
        expect(canReach(role, path)).toBe(false)
      }
    }
  })

  /* Occupancy has no per-agency scoping behind it yet - every zone comes back
     regardless of role - so restricting who may look is the only lever this
     table has until the feed itself carries an agency_id. */
  it('gives occupancy to admins and managers only', () => {
    expect(canReach('ADMIN', '/occupancy')).toBe(true)
    expect(canReach('MANAGER', '/occupancy')).toBe(true)
    for (const role of ['AGENT', 'SECURITY', 'TECHNICIAN'] as const) {
      expect(canReach(role, '/occupancy')).toBe(false)
    }
  })

  it('refuses everything to a session with no role', () => {
    expect(canReach(null, '/users')).toBe(false)
    expect(canReach(undefined, '/presence')).toBe(false)
  })

  /**
   * The one that would strand somebody.
   *
   * AppShell sends a role that cannot reach the current path to its landing
   * page. If that landing page were itself forbidden, the redirect would bounce
   * against the guard forever - so the two tables have to agree, and this is
   * the test that says so out loud.
   */
  it('gives every role a landing page it is allowed to reach', () => {
    for (const role of ROLES) {
      expect(canReach(role, landingPathFor(role))).toBe(true)
    }
  })
})
