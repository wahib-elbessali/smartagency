import type { Ticket, TicketCreate, Visitor, VisitorCreate } from '@/api/types'
import { ApiError } from '@/api/errors'
import { AGENCY_ID } from './fixtures/people'

/**
 * A writable visitor and ticket store for mock mode.
 *
 * The queue is the one screen in this dashboard that is a state machine rather
 * than a list, so the fixtures have to enforce the transitions or the screen
 * gets built against rules that do not exist. Every refusal below mirrors
 * backend/app/api/tickets.py, with the same status code and the same French
 * `detail` string.
 *
 * The most important behaviour to reproduce is the awkward one: the real
 * `/tickets/queue` returns ONLY waiting tickets. A called ticket vanishes from
 * it. If the mock returned everything, the screen would be built against a
 * queue that does not exist and would break the first time it met the real
 * backend.
 */

/* Counters belong to an agency and can be closed. Two open, one shut, so the
   "counter is closed" refusal is reachable by clicking rather than only in a
   unit test. */
export const COUNTERS = [
  { id: 'c1000000-0000-4000-8000-000000000001', number: 1, name: 'Guichet 1', is_open: true },
  { id: 'c1000000-0000-4000-8000-000000000002', number: 2, name: 'Guichet 2', is_open: true },
  { id: 'c1000000-0000-4000-8000-000000000003', number: 3, name: 'Guichet 3', is_open: false },
]

const SEED_VISITORS: Array<[string, string | null, string | null]> = [
  ['Rachid El Fassi', '0661234567', 'CIN AB123456'],
  ['Salma Bennani', '0662345678', null],
  ['Youssef Amrani', null, 'CIN CD789012'],
  ['Khadija Moussaoui', '0664567890', null],
]

let visitors: Visitor[] | null = null
let tickets: Ticket[] | null = null
let counter = 0

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function seed(): { visitors: Visitor[]; tickets: Ticket[] } {
  if (visitors === null || tickets === null) {
    visitors = SEED_VISITORS.map(([full_name, phone, identity_reference], i) => ({
      id: `v1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      agency_id: AGENCY_ID,
      full_name,
      phone,
      identity_reference,
      created_at: iso(40 - i * 8),
    }))

    /* Four waiting, oldest first - enough to show ordering matters, and to see
       the queue shorten as they are called. */
    tickets = visitors.map((visitor, i) => ({
      id: `t1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      visitor_id: visitor.id,
      visitor_name: visitor.full_name,
      agency_id: visitor.agency_id,
      counter_id: null,
      ticket_number: ticketNumber(i + 1),
      /* One with no service type: the column is nullable and the row has to
         render without it. */
      service_type: i === 2 ? null : ['Retrait', 'Ouverture de compte', '', 'Conseil'][i],
      status: 'WAITING' as const,
      created_at: visitor.created_at,
      called_at: null,
      completed_at: null,
    }))
    counter = tickets.length
  }
  return { visitors, tickets }
}

/** Same shape the backend builds: YYYYMMDD-NNN, restarting daily per agency. */
function ticketNumber(n: number): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${stamp}-${String(n).padStart(3, '0')}`
}

export function listVisitors(): Visitor[] {
  return [...seed().visitors]
}

export function createVisitor(body: VisitorCreate): Visitor {
  const created: Visitor = {
    id: `v9000000-0000-4000-8000-${String((counter += 1)).padStart(12, '0')}`,
    /* A non-ADMIN's agency is substituted server-side, so whatever arrives here
       is either the admin's choice or irrelevant. */
    agency_id: body.agency_id ?? AGENCY_ID,
    full_name: body.full_name.trim(),
    phone: body.phone ?? null,
    identity_reference: body.identity_reference ?? null,
    created_at: new Date().toISOString(),
  }
  seed().visitors.unshift(created)
  return created
}

export function createTicket(body: TicketCreate): Ticket {
  const { visitors: vs, tickets: ts } = seed()
  const visitor = vs.find((v) => v.id === body.visitor_id)
  if (!visitor) throw new ApiError('http', 'Visiteur introuvable', 404)

  const created: Ticket = {
    id: `t9000000-0000-4000-8000-${String((counter += 1)).padStart(12, '0')}`,
    visitor_id: visitor.id,
    visitor_name: visitor.full_name,
    agency_id: visitor.agency_id,
    counter_id: null,
    ticket_number: ticketNumber(ts.length + 1),
    service_type: body.service_type ?? null,
    status: 'WAITING',
    created_at: new Date().toISOString(),
    called_at: null,
    completed_at: null,
  }
  ts.push(created)
  return created
}

/**
 * WAITING only, oldest first - exactly what the real endpoint does.
 *
 * Returning called tickets here would be more convenient and would teach the
 * screen a guarantee the backend does not make.
 */
export function listQueue(): Ticket[] {
  return seed()
    .tickets.filter((t) => t.status === 'WAITING')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function find(id: string): Ticket {
  const ticket = seed().tickets.find((t) => t.id === id)
  if (!ticket) throw new ApiError('http', 'Ticket introuvable', 404)
  return ticket
}

export function callTicket(id: string, counterId: string): Ticket {
  const ticket = find(id)
  /* 409, not 422: the request is well formed, the ticket's state is the
     problem. Two people calling the same person is the obvious way to hit it. */
  if (ticket.status !== 'WAITING') {
    throw new ApiError('http', 'Ce ticket n est plus en attente', 409)
  }

  const found = COUNTERS.find((c) => c.id === counterId)
  if (!found) throw new ApiError('http', 'Guichet introuvable', 404)
  if (!found.is_open) throw new ApiError('http', 'Le guichet est ferme', 409)

  ticket.counter_id = found.id
  ticket.status = 'CALLED'
  ticket.called_at = new Date().toISOString()
  return { ...ticket }
}

export function completeTicket(id: string): Ticket {
  const ticket = find(id)
  if (ticket.status !== 'CALLED' && ticket.status !== 'IN_SERVICE') {
    throw new ApiError('http', 'Ce ticket ne peut pas etre termine', 409)
  }
  ticket.status = 'COMPLETED'
  ticket.completed_at = new Date().toISOString()
  return { ...ticket }
}

export function cancelTicket(id: string): Ticket {
  const ticket = find(id)
  if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') {
    throw new ApiError('http', 'Ce ticket est deja termine ou annule', 409)
  }
  ticket.status = 'CANCELLED'
  return { ...ticket }
}

/** Tests only - module state would otherwise leak between them. */
export function resetTicketStore(): void {
  visitors = null
  tickets = null
  counter = 0
}
