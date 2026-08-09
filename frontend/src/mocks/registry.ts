import { ApiError } from '@/api/errors'
import type { MockScenario } from './scenario'

/**
 * Maps an endpoint key to its four fixture variants.
 *
 * Fixtures are registered here rather than imported by screens, so that
 * flipping VITE_USE_MOCKS=false removes the mock path entirely and no component
 * has to change.
 *
 * The registry is intentionally EMPTY. Fixture contents are the one part of
 * this layer that needs real field names, and contracts/api.md has no endpoint
 * entries yet - see src/mocks/fixtures/README.md.
 */

/** `error` is optional: absent means "this endpoint has no error fixture yet". */
export type MockVariants<T> = {
  normal: () => T
  empty: () => T
  large: () => T
  error?: () => never
}

const registry = new Map<string, MockVariants<unknown>>()

export function registerMock<T>(key: string, variants: MockVariants<T>): void {
  registry.set(key, variants as MockVariants<unknown>)
}

/**
 * Write endpoints, which the variant model does not fit.
 *
 * A fixture set is four pure functions keyed by scenario. That works for reads
 * and not at all for writes: a create has a request body, has to change what
 * subsequent reads return, and can legitimately fail on a uniqueness clash.
 * Registering them separately keeps resolveMock honest rather than bending it.
 */
/** Gets the real path too, because the id lives there rather than in the body. */
type MockWriter = (body: unknown, path: string) => unknown

const writers = new Map<string, MockWriter>()

export function registerMockWriter(key: string, writer: MockWriter): void {
  writers.set(key, writer)
}

export function hasMockWriter(key: string): boolean {
  return writers.has(key)
}

export function resolveMockWrite<T>(key: string, body: unknown, path: string): T {
  const writer = writers.get(key)
  if (!writer) {
    throw new ApiError(
      'not_implemented',
      `No mock writer registered for "${key}". Add one under src/mocks/ if this endpoint needs to work on fixtures.`,
    )
  }
  return writer(body, path) as T
}

export function resolveMock<T>(key: string, scenario: MockScenario): T {
  const variants = registry.get(key) as MockVariants<T> | undefined

  if (!variants) {
    throw new ApiError(
      'not_implemented',
      `No fixture registered for "${key}". Add one under src/mocks/fixtures/ once contracts/api.md defines this endpoint.`,
    )
  }

  if (scenario === 'error') {
    if (!variants.error) {
      throw new ApiError('http', `Simulated failure for "${key}".`, 500)
    }
    return variants.error()
  }

  return variants[scenario]()
}
