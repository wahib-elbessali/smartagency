import { API_BASE_URL, MOCK_SCENARIO, REQUEST_TIMEOUT_MS, USE_MOCKS } from './config'
import { ApiError, toApiError } from './errors'
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
}

export async function fetchJson<T>(endpoint: EndpointDescriptor, signal?: AbortSignal): Promise<T> {
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

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint.path}`, {
      headers: { Accept: 'application/json' },
      /* Explicit, not left to the default. If the backend ends up using cookie
         sessions this has to become 'include' AND the backend has to send
         SameSite plus a CSRF token we echo on state-changing requests - the
         token's header name is the backend's to define, so it is not invented
         here. Until that is decided, credentials are not sent at all. */
      credentials: 'same-origin',
      signal: combined,
    })
  } catch (cause) {
    throw toApiError(cause)
  }

  if (!response.ok) {
    throw new ApiError('http', `Request to ${endpoint.path} failed.`, response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('parse', `Response from ${endpoint.path} was not valid JSON.`)
  }
}
