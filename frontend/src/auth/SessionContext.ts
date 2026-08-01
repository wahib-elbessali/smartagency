import { createContext, use } from 'react'

/**
 * Session context and its hook, kept out of the provider file so that file
 * exports only a component - otherwise fast refresh stops working for it.
 *
 * There is no user object here. Which fields describe a user is contract
 * territory, and contracts/api.md has no authentication endpoint yet, so this
 * tracks only whether a session exists.
 */

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

export interface SessionValue {
  status: SessionStatus
  signIn(credentials: { username: string; password: string }): Promise<void>
  signOut(): void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = use(SessionContext)
  if (!value) throw new Error('useSession must be used inside a SessionProvider')
  return value
}
