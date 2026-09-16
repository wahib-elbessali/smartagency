import { fetchJson } from '../client'
import { ApiError, describeApiError } from '../errors'
import type { Ticket, TicketCreate } from '../types'

/**
 * Ticket endpoints — ADMIN, MANAGER and AGENT only. SECURITY is deliberately
 * absent here even though it may create visitors.
 *
 * The state machine the backend enforces:
 *
 *   WAITING --call--> CALLED --complete--> COMPLETED
 *      |                 |
 *      +------cancel-----+--> CANCELLED
 *
 * IN_SERVICE exists in the database enum and no route produces it.
 *
 * Each refusal is a 409 rather than a 422, because the request is well formed -
 * it is the ticket's current state that makes it impossible.
 */

/**
 * The waiting queue - and ONLY the waiting queue.
 *
 * This is the significant limitation of the whole screen. The endpoint filters
 * to `status == WAITING`, so the moment a ticket is called it disappears from
 * the only list route that exists. There is no way to ask the server which
 * tickets are currently at a counter, which means "now serving" cannot survive
 * a page reload - the screen has to remember it, and forgets on refresh.
 *
 * Ordered oldest first, which is the order they should be called in.
 *
 * `serviceId` narrows to one service's queue, added alongside `service_id` on
 * TicketCreate (2026-08-27). Omit it for the whole agency's queue.
 */
export function fetchQueue(serviceId?: string, signal?: AbortSignal): Promise<Ticket[]> {
  const path = serviceId
    ? `/api/tickets/queue?service_id=${encodeURIComponent(serviceId)}`
    : '/api/tickets/queue'
  return fetchJson<Ticket[]>({ key: 'GET /api/tickets/queue', path, auth: true }, { signal })
}

/**
 * Issues a ticket to a visitor who already exists, for a service that must
 * belong to the same agency as the visitor.
 *
 * The number is assigned server-side as "YYYYMMDD-SERVICE_CODE-001", counted
 * per agency, per service and restarting daily - so it is never sent and
 * never guessed here.
 */
export function createTicket(body: TicketCreate, signal?: AbortSignal): Promise<Ticket> {
  return fetchJson<Ticket>(
    { key: 'POST /api/tickets', path: '/api/tickets', method: 'POST', auth: true },
    { signal, body },
  )
}

/**
 * Calls a waiting ticket to a counter.
 *
 * Four ways this refuses, all of them reachable by a person clicking normally:
 * the ticket is no longer WAITING (409), the counter does not exist (404), the
 * counter belongs to another agency (422), or the counter is closed (409).
 * Counters come from the nested `counters` on GET /api/agencies.
 */
export function callTicket(id: string, counterId: string, signal?: AbortSignal): Promise<Ticket> {
  return fetchJson<Ticket>(
    {
      key: 'POST /api/tickets/{id}/call',
      path: `/api/tickets/${id}/call`,
      method: 'POST',
      auth: true,
    },
    { signal, body: { counter_id: counterId } },
  )
}

/**
 * Only valid from CALLED or IN_SERVICE; anything else is a 409.
 *
 * `notes` is PROPOSED - the real route takes no body today (contracts/api.md
 * §8), so this only reaches the mock until the backend accepts it. Omitting
 * it sends no body at all, unchanged from before notes existed.
 */
export function completeTicket(id: string, notes?: string, signal?: AbortSignal): Promise<Ticket> {
  return fetchJson<Ticket>(
    {
      key: 'POST /api/tickets/{id}/complete',
      path: `/api/tickets/${id}/complete`,
      method: 'POST',
      auth: true,
    },
    { signal, body: notes === undefined ? undefined : { notes } },
  )
}

/** Valid from any state except COMPLETED and CANCELLED, which give a 409. */
export function cancelTicket(id: string, signal?: AbortSignal): Promise<Ticket> {
  return fetchJson<Ticket>(
    {
      key: 'POST /api/tickets/{id}/cancel',
      path: `/api/tickets/${id}/cancel`,
      method: 'POST',
      auth: true,
    },
    { signal },
  )
}

/**
 * Turns a call/complete/cancel failure into what a screen shows a person.
 *
 * Shared by VisitorQueueBoard and AgentQueue - both act on the same four
 * routes above and hit the same refusals.
 */
export function actionErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'That did not work.'

  switch (error.status) {
    /* Every 409 here means the ticket moved under you - most likely a colleague
       called the same person from another desk. Refetching is the fix, and the
       queue does it automatically after every action. */
    case 409:
      return 'That ticket has already been handled, or the counter is closed. The queue has been refreshed.'
    case 404:
      return 'That ticket or counter no longer exists.'
    case 422:
      return 'That counter cannot take this ticket — wrong branch or wrong service. The queue has been refreshed.'
    default:
      return describeApiError(error)
  }
}
