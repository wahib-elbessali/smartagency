import { fetchJson } from '../client'
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

/** Only valid from CALLED or IN_SERVICE; anything else is a 409. */
export function completeTicket(id: string, signal?: AbortSignal): Promise<Ticket> {
  return fetchJson<Ticket>(
    {
      key: 'POST /api/tickets/{id}/complete',
      path: `/api/tickets/${id}/complete`,
      method: 'POST',
      auth: true,
    },
    { signal },
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
