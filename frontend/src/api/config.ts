import type { MockScenario } from '@/mocks/scenario'
import { isMockScenario } from '@/mocks/scenario'

/**
 * Every runtime switch the app needs, read in one place.
 *
 * Components must never read import.meta.env directly - if they do, "am I on
 * fixtures or the real backend?" stops being answerable from a single file.
 *
 * Security note: Vite inlines every VITE_-prefixed variable into the client
 * bundle in plain text. So nothing secret goes in one - no API keys, no tokens,
 * no credentials. Anything secret belongs on the backend. See SECURITY.md.
 */

/** Fixtures are the default: there is no backend to point at yet. */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'

/** Trailing slash trimmed so callers can always write paths as '/some/path'. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * contracts/api.md now defines POST /api/auth/login, so this can finally be
 * turned on. Still defaulting to off: the login REQUEST body is undocumented
 * (see endpoints/auth.ts), so against a real backend the guard would still lock
 * every screen behind a login that cannot succeed. On mocks, set it to true and
 * the whole flow works.
 */
export const AUTH_ENFORCED = import.meta.env.VITE_AUTH_ENFORCED === 'true'

/**
 * Origin for WS /ws/attendance.
 *
 * Defaults to API_BASE_URL with the scheme swapped, which is right whenever the
 * socket is served from the same origin as the REST API. Override only if the
 * backend puts it somewhere else.
 */
export const WS_BASE_URL = (
  import.meta.env.VITE_WS_BASE_URL ?? API_BASE_URL.replace(/^http/, 'ws')
).replace(/\/+$/, '')

/**
 * How the JWT is presented to the WebSocket.
 *
 * contracts/api.md says WS /ws/attendance "requires a valid JWT token" but not
 * HOW. This matters because a browser cannot set an Authorization header on a
 * WebSocket handshake - that is a hard limitation of the API, not an oversight.
 * The two mechanisms actually available are a query parameter or the
 * Sec-WebSocket-Protocol subprotocol field, and only the backend knows which it
 * implements.
 *
 * So this is a switch with no default rather than a guess. Unset means the
 * socket refuses to connect and says why. Ask Ahmed, set the variable, done.
 */
export type WsAuthMode = 'query' | 'subprotocol'

export const WS_AUTH_MODE: WsAuthMode | null =
  import.meta.env.VITE_WS_AUTH_MODE === 'query'
    ? 'query'
    : import.meta.env.VITE_WS_AUTH_MODE === 'subprotocol'
      ? 'subprotocol'
      : null

/** Name of the query parameter when WS_AUTH_MODE is 'query'. Backend's call. */
export const WS_AUTH_QUERY_PARAM = import.meta.env.VITE_WS_AUTH_QUERY_PARAM ?? 'token'

/** Reconnect backoff for the attendance socket. */
export const WS_RECONNECT_MS = { min: 1_000, max: 30_000 } as const

/**
 * Fake latency band for mocked responses. Without this every screen gets built
 * with no loading state and then looks broken the first time it hits a network.
 */
export const MOCK_LATENCY_MS = { min: 200, max: 800 } as const

/** Real requests abort at this point rather than spinning forever. */
export const REQUEST_TIMEOUT_MS = 10_000

export const MOCK_SCENARIO: MockScenario = isMockScenario(import.meta.env.VITE_MOCK_SCENARIO)
  ? import.meta.env.VITE_MOCK_SCENARIO
  : 'normal'
