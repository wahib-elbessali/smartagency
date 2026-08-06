import type { User } from './types'

/**
 * The access token lives here, in a module variable, and nowhere else.
 *
 * Not localStorage and not sessionStorage: SECURITY.md's rule is that if we get
 * bearer tokens, they stay in memory so that an XSS cannot read them back out.
 * The cost is that a refresh signs you out - that is the trade being made
 * deliberately, and it is what `refresh_token` would eventually soften once a
 * refresh endpoint exists in the contract (it does not yet).
 *
 * Not React state either, because api/client.ts has to read it and client.ts is
 * not a component. Subscribers get notified so the UI can still react.
 */

interface Session {
  accessToken: string
  refreshToken: string
  user: User
}

let current: Session | null = null
const listeners = new Set<(session: Session | null) => void>()

export function getSession(): Session | null {
  return current
}

export function getAccessToken(): string | null {
  return current?.accessToken ?? null
}

export function setSession(session: Session | null): void {
  current = session
  for (const listener of listeners) listener(current)
}

export function clearSession(): void {
  setSession(null)
}

export function subscribeToSession(listener: (session: Session | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type { Session }
