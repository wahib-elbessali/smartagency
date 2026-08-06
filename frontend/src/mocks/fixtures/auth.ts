import { registerMock } from '../registry'
import type { LoginResponse, User } from '@/api/types'
import { AGENCY_ID } from './people'

/**
 * Field names from POST /api/auth/login and GET /api/auth/me.
 *
 * The token strings are obviously fake and are meant to look it. They are never
 * verified by anything in mock mode - the point of these fixtures is to exercise
 * the session plumbing, not to pretend to be a security boundary.
 */

function manager(): User {
  return {
    id: 'u1000000-0000-4000-8000-000000000001',
    full_name: 'Fatima Abbar',
    email: 'fatima@agency.com',
    role: 'MANAGER',
    agency_id: AGENCY_ID,
    is_active: true,
  }
}

function admin(): User {
  return {
    id: 'u1000000-0000-4000-8000-000000000002',
    full_name: 'Admin Test',
    email: 'admin@test.com',
    role: 'ADMIN',
    agency_id: null,
    is_active: true,
  }
}

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

registerMock<User>('GET /api/auth/me', {
  normal: manager,
  empty: admin,
  large: admin,
})
