import { API_BASE_URL, MOCK_SCENARIO, REQUEST_TIMEOUT_MS, USE_MOCKS } from './config'
import { ApiError, toApiError } from './errors'
import { getAccessToken } from './tokenStore'
import { mockDelay } from '@/mocks/latency'
import { resolveMock } from '@/mocks/registry'

/**
 * The single place that decides fixture vs real backend.
 *
 * Screens never call this. They call an endpoint module in src/api/endpoints/,
 * which calls this. That keeps the swap to a live backend a change to
 * .env alone - playbook 6.
 */

export interface EndpointDescriptor {
  /** Registry key for the fixture set. Convention: the contract path. */
  key: string
  /** Real path exactly as written in contracts/api.md, e.g. '/some/path'. */
  path: string
  /** Defaults to GET. */
  method?: 'GET' | 'POST' | 'PATCH'
  /**
   * Whether to send `Authorization: Bearer <token>`.
   *
   * Explicit per endpoint rather than "send it whenever we have one", because
   * POST /api/auth/login is the one call that must NOT carry a stale token, and
   * a default-on rule makes that an easy accident.
   */
  auth?: boolean
}

export interface RequestOptions {
  signal?: AbortSignal
  /** JSON request body. Only for POST/PATCH. */
  body?: unknown
}

export async function fetchJson<T>(
  endpoint: EndpointDescriptor,
  options: RequestOptions = {},
): Promise<T> {
  const { signal, body } = options

  if (USE_MOCKS) {
    await mockDelay(signal)
    return resolveMock<T>(endpoint.key, MOCK_SCENARIO)
  }

  if (!API_BASE_URL) {
    throw new ApiError(
      'not_implemented',
      'VITE_USE_MOCKS is false but VITE_API_BASE_URL is not set.',
    )
  }

  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (endpoint.auth) {
    const token = getAccessToken()
    if (!token) {
      /* Failing here rather than sending an unauthenticated request means the
         screen shows "you are signed out" instead of a bare 401 it has to
         interpret. */
      throw new ApiError('http', 'Not signed in.', 401)
    }
    /* "bearer" is what POST /api/auth/login returns as token_type. The scheme
       token in the header is conventionally capitalised; if the backend turns
       out to be strict about the lowercase form, this one line is the fix. */
    headers.Authorization = `Bearer ${token}`
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint.path}`, {
      method: endpoint.method ?? 'GET',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      /* Explicit, not left to the default. The contract answers this now: auth
         is bearer tokens, not cookie sessions, so credentials are not sent and
         CSRF is not in play. See SECURITY.md. */
      credentials: 'same-origin',
      signal: combined,
    })
  } catch (cause) {
    throw toApiError(cause)
  }

  if (!response.ok) {
    throw new ApiError('http', `Request to ${endpoint.path} failed.`, response.status)
  }

  if (response.status === 204) return undefined as T

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('parse', `Response from ${endpoint.path} was not valid JSON.`)
  }
}
