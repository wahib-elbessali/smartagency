import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from '@/api/errors'
import { SessionContext, type SessionStatus, type SessionValue } from './SessionContext'

/**
 * Holds session state and exposes sign-in / sign-out.
 *
 * What is deliberately missing: the sign-in request itself. A login endpoint is
 * an endpoint - its path, its request body and its response shape all belong in
 * contracts/api.md, and none of that is written yet. So `signIn` fails with a
 * clear not_implemented error and the UI renders it through the normal error
 * path. Everything around it - the provider, the guard, the redirect, the form -
 * is real and works the moment the contract entry lands.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  /* Starts 'anonymous' rather than 'unknown' because there is no session
     endpoint to ask yet. Once one exists this becomes 'unknown' until the
     restore call answers. */
  const [status, setStatus] = useState<SessionStatus>('anonymous')

  const signIn = useCallback(async () => {
    throw new ApiError(
      'not_implemented',
      'Sign-in is not wired up yet: contracts/api.md has no authentication endpoint. ' +
        'The screen, the session state and the route guard are ready for it.',
    )
  }, [])

  const signOut = useCallback(() => setStatus('anonymous'), [])

  const value = useMemo<SessionValue>(
    () => ({ status, signIn, signOut }),
    [status, signIn, signOut],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}
