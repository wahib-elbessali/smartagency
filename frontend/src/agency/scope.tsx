import { useCallback, useEffect, useMemo, useState, use, type ReactNode } from 'react'
import { SessionContext } from '@/auth/SessionContext'
import { ScopeContext, type ScopeValue } from './ScopeContext'

/**
 * Holds the branch an admin is working inside.
 *
 * Only an ADMIN can be inside one, because only an ADMIN has more than one to
 * choose from - every other role already receives a single agency's data from
 * the backend, and giving them a control that could only ever select what they
 * already have would suggest they had a choice.
 *
 * Reset on any change of who is signed in. That covers signing out, and it
 * covers the fixture-mode role preview: coming back as a MANAGER while still
 * holding an admin's chosen branch would filter their already-filtered data
 * against a branch that is not theirs, and quietly show them nothing.
 */
export function ScopeProvider({ children }: { children: ReactNode }) {
  /* Read straight from the context rather than through useSession, which
     throws. This provider sits above the router and has a sensible answer with
     no session at all - nobody is signed in, so nobody is inside a branch - and
     refusing to render would make it the one provider that cannot be mounted
     on its own. */
  const user = use(SessionContext)?.user ?? null
  const [scoped, setScoped] = useState<{ id: string; name: string } | null>(null)

  const isAdmin = user?.role === 'ADMIN'
  const userId = user?.id ?? null

  useEffect(() => {
    setScoped(null)
  }, [userId])

  const enter = useCallback((agency: { id: string; name: string }) => {
    setScoped({ id: agency.id, name: agency.name })
  }, [])

  const leave = useCallback(() => setScoped(null), [])

  const value = useMemo<ScopeValue>(
    () => ({
      /* Held but not applied for a non-admin, so a role preview that lands
         mid-session cannot filter data it has no business filtering. */
      agencyId: isAdmin ? (scoped?.id ?? null) : null,
      agencyName: isAdmin ? (scoped?.name ?? null) : null,
      enter,
      leave,
    }),
    [isAdmin, scoped, enter, leave],
  )

  return <ScopeContext value={value}>{children}</ScopeContext>
}
