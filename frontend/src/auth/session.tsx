import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { login, type Credentials } from '@/api/endpoints/auth'
import { clearSession, setSession } from '@/api/tokenStore'
import { SessionContext, type SessionStatus, type SessionValue } from './SessionContext'
import type { User } from '@/api/types'

/**
 * Holds session state and performs sign-in.
 *
 * The request itself now exists, because contracts/api.md defines
 * POST /api/auth/login. Its RESPONSE is fully specified, so everything below is
 * real. Its REQUEST body is not specified, and that one gap is isolated inside
 * src/api/endpoints/auth.ts rather than smeared across this file.
 *
 * Starts 'anonymous' rather than 'unknown' on purpose. The access token lives in
 * memory (SECURITY.md), so after a page reload there is nothing to restore and
 * no call to wait on - a reload signs you out. That is the deliberate cost of
 * not putting a bearer token where an XSS can read it. If a restore is wanted,
 * it needs the refresh endpoint that the contract does not yet document.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('anonymous')
  const [user, setUser] = useState<User | null>(null)

  const signIn = useCallback(async (credentials: Credentials) => {
    const response = await login(credentials)

    setSession({
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      user: response.user,
    })
    setUser(response.user)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo<SessionValue>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}
