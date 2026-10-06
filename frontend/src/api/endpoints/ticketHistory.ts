import { fetchJson } from '../client'
import type { Ticket } from '../types'

/**
 * PROPOSED - `GET /api/tickets?from=ISO&to=ISO`. Not in contracts/api.md and
 * not in backend/app/api/tickets.py yet; asked for in BACKEND-ASKS.
 *
 * WHY A TICKET LIST AND NOT A STATS ENDPOINT. Every number the client
 * statistics screen shows - came, served, cancelled, average wait, average
 * service time, per service, per hour, per day - is derivable from fields a
 * Ticket already carries (`status`, `created_at`, `called_at`, `completed_at`,
 * `service_name`). Asking for the rows rather than a precomputed summary means
 * the only new thing is a route and two query parameters: no new field names,
 * and the backend does not have to agree with us on what "average wait" means.
 *
 * The only list route today is `/api/tickets/queue`, which returns WAITING
 * tickets only, so a served client is invisible to the frontend the moment
 * they are called. That is the gap this fills.
 *
 * Expected semantics, same as the queue: ADMIN, MANAGER, AGENT; non-ADMIN
 * callers see their own agency only; tickets whose `created_at` falls in
 * [from, to), every status, oldest first.
 */
export function fetchTicketHistory(from: Date, to: Date, signal?: AbortSignal): Promise<Ticket[]> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
  return fetchJson<Ticket[]>(
    { key: 'GET /api/tickets', path: `/api/tickets?${query}`, auth: true },
    { signal },
  )
}
