import { useQueries, useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router'
import { Bell } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchStoredAlerts } from '@/api/endpoints/alerts'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { cn } from '@/components/ui/cn'

/**
 * The top bar's notifications control: how many stored alerts are still open,
 * and a way to the Alerts screen.
 *
 * THERE IS NO NOTIFICATIONS FEATURE in the API, and this does not pretend
 * there is one. What does exist is the stored alerts list (contracts/api.md
 * §14, GET /api/agencies/{id}/alerts), so the count is exactly what the
 * Alerts screen would show as not yet resolved - the same `!== 'RESOLVED'`
 * rule WeaponAlertHistory uses. No count is shown until every request has
 * answered: a partial sum would be a wrong number, and a wrong number on a
 * security control is worse than none.
 *
 * Scope follows the rest of the app. A manager or guard counts their own
 * branch. An admin has no branch, so they count the one they are working
 * inside, or every branch when they are not inside one. The caller only
 * renders this for roles that can reach /alerts.
 *
 * Polled once a minute. The live socket would be fresher, but holding an
 * alert stream open on every screen just for a badge costs one of the five
 * AI sockets each user is allowed (#110).
 */
export function AlertsBell({ className }: { className?: string }) {
  const { user } = useSession()
  const scope = useScope()
  const isAdmin = user?.role === 'ADMIN'

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
    enabled: isAdmin && !scope.agencyId,
  })

  const agencyIds = isAdmin
    ? scope.agencyId
      ? [scope.agencyId]
      : (agencies.data ?? []).map((agency) => agency.id)
    : user?.agency_id
      ? [user.agency_id]
      : []

  const results = useQueries({
    queries: agencyIds.map((id) => ({
      queryKey: ['storedAlerts', id, 'all'],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchStoredAlerts(id, undefined, signal),
      refetchInterval: 60_000,
    })),
  })

  const ready = results.length > 0 && results.every((result) => result.data !== undefined)
  const open = ready
    ? results.reduce(
        (sum, result) =>
          sum + (result.data ?? []).filter((alert) => alert.status !== 'RESOLVED').length,
        0,
      )
    : 0

  return (
    <NavLink
      to="/alerts"
      aria-label={open > 0 ? `Alerts, ${open} open` : 'Alerts'}
      title={open > 0 ? `${open} open ${open === 1 ? 'alert' : 'alerts'}` : 'Alerts'}
      className={({ isActive }) =>
        cn(
          'ease-soft relative grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-150',
          isActive ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink hover:bg-panel-2',
          className,
        )
      }
    >
      <Bell className="size-4" aria-hidden />
      {open > 0 && (
        /* Dark text on the red, not white: white on this red is about 3:1,
           too little for 10px digits. */
        <span
          aria-hidden
          className="bg-danger text-canvas tabular absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold"
        >
          {open > 99 ? '99+' : open}
        </span>
      )}
    </NavLink>
  )
}
