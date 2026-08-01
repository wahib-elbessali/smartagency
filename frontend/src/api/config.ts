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
 * Off until an authentication endpoint exists in contracts/api.md. Turning it
 * on now would put every screen behind a login that cannot succeed.
 */
export const AUTH_ENFORCED = import.meta.env.VITE_AUTH_ENFORCED === 'true'

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
