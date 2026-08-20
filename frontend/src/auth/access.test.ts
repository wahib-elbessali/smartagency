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

  /* Attendance is ADMIN, MANAGER and SECURITY - security staff read the roster
     even though they cannot administer the people on it. */
  it('includes security on presence', () => {
    expect(canReach('SECURITY', '/presence')).toBe(true)
    expect(canReach('AGENT', '/presence')).toBe(false)
  })

  /* No role-guarded endpoint behind these, so no role is kept out. Two are
     still <ContractPending>, which is a different thing from forbidden. */
  it('offers the unguarded screens to everyone', () => {
    for (const role of ROLES) {
      for (const path of ['/climate', '/occupancy', '/alerts', '/controls']) {
        expect(canReach(role, path)).toBe(true)
      }
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
