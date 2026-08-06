import { fetchJson } from '../client'
import type { LoginResponse, User } from '../types'

/**
 * Auth endpoints.
 *
 * The login REQUEST body is still not in contracts/api.md - that entry's
 * `**Payload:**` block shows the response. It is documented here instead
 * because the backend source settles it:
 *
 *   backend/app/schemas/auth.py
 *     class LoginRequest(BaseModel):
 *         email: str
 *         password: str
 *
 * That is ground truth for what the server accepts, so this is transcribed
 * rather than guessed. The contract still needs the entry - raised in
 * #api-contract - and until it has one, this file is the only place the shape
 * is written down on our side.
 *
 * The backend strips and lowercases the email before lookup, so no client-side
 * normalisation is needed here.
 */

export interface Credentials {
  email: string
  password: string
}

export function login(credentials: Credentials, signal?: AbortSignal): Promise<LoginResponse> {
  return fetchJson<LoginResponse>(
    { key: 'POST /api/auth/login', path: '/api/auth/login', method: 'POST' },
    { signal, body: { email: credentials.email, password: credentials.password } },
  )
}

export function fetchCurrentUser(signal?: AbortSignal): Promise<User> {
  return fetchJson<User>({ key: 'GET /api/auth/me', path: '/api/auth/me', auth: true }, { signal })
}
