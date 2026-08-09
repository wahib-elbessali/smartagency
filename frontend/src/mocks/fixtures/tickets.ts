import { registerMock, registerMockWriter } from '../registry'
import type { Ticket, TicketCreate, Visitor, VisitorCreate } from '@/api/types'
import * as store from '../ticketStore'

/**
 * Field names from VisitorResponse and TicketResponse in
 * backend/app/schemas/. Both were added by PR #67 and are now on master.
 *
 * `normal` reads through the writable store, because this screen is almost
 * entirely writes - a frozen queue that never shortens when you call someone
 * would be useless for building against.
 */

registerMock<Visitor[]>('GET /api/visitors', {
  normal: () => store.listVisitors(),
  empty: () => [],
  large: () => store.listVisitors(),
})

registerMock<Ticket[]>('GET /api/tickets/queue', {
  normal: () => store.listQueue(),
  /* An empty queue is the normal state of a quiet branch, not a failure, and
     the screen has to say so warmly rather than looking broken. */
  empty: () => [],
  large: () => store.listQueue(),
})

registerMockWriter('POST /api/visitors', (body) => store.createVisitor(body as VisitorCreate))
registerMockWriter('POST /api/tickets', (body) => store.createTicket(body as TicketCreate))

/** The id sits in the path, and the action is the segment after it. */
function idFrom(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 2] ?? ''
}

registerMockWriter('POST /api/tickets/{id}/call', (body, path) =>
  store.callTicket(idFrom(path), (body as { counter_id: string }).counter_id),
)

registerMockWriter('POST /api/tickets/{id}/complete', (_body, path) =>
  store.completeTicket(idFrom(path)),
)

registerMockWriter('POST /api/tickets/{id}/cancel', (_body, path) =>
  store.cancelTicket(idFrom(path)),
)
