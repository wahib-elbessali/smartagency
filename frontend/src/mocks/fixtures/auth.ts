import { registerMock } from '../registry'
import type { LoginResponse, User } from '@/api/types'
import { mockAdmin as admin, mockManager as manager } from '../currentUser'

/**
 * Field names from POST /api/auth/login and GET /api/auth/me.
 *
 * The token strings are obviously fake and are meant to look it. They are never
 * verified by anything in mock mode - the point of these fixtures is to exercise
 * the session plumbing, not to pretend to be a security boundary.
 *
 * The two users themselves live in ../currentUser, because the other fixtures
 * have to know which of them is asking before they can scope a response the way
 * the backend does.
 */

function loginAs(user: User): LoginResponse {
  return {
    access_token: 'FIXTURE.ACCESS.TOKEN',
    refresh_token: 'FIXTURE.REFRESH.TOKEN',
    token_type: 'bearer',
    user,
  }
}

registerMock<LoginResponse>('POST /api/auth/login', {
  normal: () => loginAs(manager()),
  /* There is no "empty" login - the shape is the same whoever signs in. The
     ADMIN variant is more useful here: agency_id is null for an admin, which is
     the case most likely to crash a screen that assumes it is a string. */
  empty: () => loginAs(admin()),
  large: () => loginAs(admin()),
})

/* Same shape as login - the backend returns a full TokenResponse from refresh,
   rotating both halves. Distinct token strings so a test can tell them apart. */
registerMock<LoginResponse>('POST /api/auth/refresh', {
  normal: () => ({
    ...loginAs(manager()),
    access_token: 'FIXTURE.ACCESS.TOKEN.REFRESHED',
    refresh_token: 'FIXTURE.REFRESH.TOKEN.REFRESHED',
  }),
  empty: () => ({
    ...loginAs(admin()),
    access_token: 'FIXTURE.ACCESS.TOKEN.REFRESHED',
    refresh_token: 'FIXTURE.REFRESH.TOKEN.REFRESHED',
  }),
  large: () => ({
    ...loginAs(admin()),
    access_token: 'FIXTURE.ACCESS.TOKEN.REFRESHED',
    refresh_token: 'FIXTURE.REFRESH.TOKEN.REFRESHED',
  }),
})

registerMock<User>('GET /api/auth/me', {
  normal: manager,
  empty: admin,
  large: admin,
})
