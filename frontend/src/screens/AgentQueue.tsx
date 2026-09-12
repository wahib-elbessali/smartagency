import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, TriangleAlert } from 'lucide-react'
import { fetchMyAssignment } from '@/api/endpoints/assignments'
import { actionErrorMessage, callTicket, completeTicket, fetchQueue } from '@/api/endpoints/tickets'
import type { Ticket, TicketOutcome } from '@/api/types'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { Clock } from '@/components/ui/Time'
import { Screen } from './Screen'

/**
 * The AGENT's queue: one ticket at a time, a place to note how it went, and a
 * button to move on.
 *
 * Everything VisitorQueueBoard shows an ADMIN or MANAGER - the full waiting
 * list, every counter, visitor registration - is deliberately absent. An
 * agent at a desk needs to know who they're with and who's next, not run a
 * management console.
 *
 * WHO ASSIGNS THE SERVICE
 *
 * This used to ask the agent to pick their own service and counter. Changed
 * (2026-09-05): which service an agent works is a MANAGER's call, not the
 * agent's, so this now reads it from GET /api/agents/me/assignment instead of
 * showing a picker. That endpoint is PROPOSED - nothing on the real backend
 * stores an agent-to-counter link yet (checked backend/app/models/entities.py)
 * - so it is wired against a mock for now (mocks/assignmentStore.ts) with the
 * exact shape the real one should return. See api/endpoints/assignments.ts.
 * An agent nobody has assigned sees an honest empty state, not a picker.
 *
 * "Currently serving" has the same limitation as the board's at-counter
 * panel: GET /api/tickets/queue returns WAITING tickets only, so the one just
 * called has to be remembered locally rather than read back from the server.
 *
 * HOW A VISIT ENDS
 *
 * Two buttons, not one (2026-09-09, at the user's direction). Done and
 * Problem both finish the ticket and call the next person - the difference is
 * the `outcome` they record, which is what makes "how many operations
 * succeeded today" a question anyone can answer later.
 *
 * The note follows the outcome rather than sitting there permanently. It used
 * to be an always-visible optional box asking "How did it go?", which is a
 * question an agent has to read and dismiss dozens of times a day in order to
 * answer "fine" - so it stayed empty, and an empty box teaches people to skip
 * boxes. It now appears only after Problem is pressed, and is required there:
 * the note IS the reason, and a failure with no reason recorded is a number
 * nobody can act on.
 *
 * `outcome` and `notes` are both PROPOSED - the real route takes no body today
 * (contracts/api.md §8). Sent regardless; FastAPI drops an unexpected body, so
 * against a real server the ticket still completes and the outcome is lost
 * until the backend grows a column. See api/endpoints/tickets.ts for the exact
 * request shape to ask for.
 */

const POLL_MS = 10_000

export default function AgentQueue() {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState<Ticket | null>(null)
  const [note, setNote] = useState('')
  /* Whether the agent has said something went wrong. Drives the note field,
     which exists only in that branch. */
  const [reporting, setReporting] = useState(false)

  const assignment = useQuery({
    queryKey: ['myAssignment'],
    queryFn: ({ signal }) => fetchMyAssignment(signal),
  })

  const assigned = assignment.data ?? null
  const serviceId = assigned?.service_id ?? null
  const counterId = assigned?.counter_id ?? null

  const queue = useQuery({
    queryKey: ['tickets', 'queue', serviceId],
    queryFn: ({ signal }) => fetchQueue(serviceId ?? undefined, signal),
    enabled: serviceId != null,
    refetchInterval: POLL_MS,
  })

  const waiting = queue.data ?? []
  const next = waiting[0] ?? null

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tickets', 'queue'] })

  const advance = useMutation({
    /* Complete whoever is current (if anyone), then call whoever is next.
     *
     * "Next" is re-fetched here rather than read from `next` above: the render
     * scope's `waiting` can be a poll interval stale, and pressing this button
     * twice in quick succession - exactly how it's meant to be used - would
     * otherwise call the same ticket id twice and earn a 409 on the second
     * press, before the first press's own refetch had a chance to land.
     */
    /* `finish` is null when nobody is at the counter yet - the first press of
       a shift calls someone without finishing anyone. */
    mutationFn: async (finish: { outcome: TicketOutcome; notes?: string } | null) => {
      if (current && finish) await completeTicket(current.id, finish.outcome, finish.notes)
      const fresh = await queryClient.fetchQuery({
        queryKey: ['tickets', 'queue', serviceId],
        queryFn: ({ signal }) => fetchQueue(serviceId ?? undefined, signal),
      })
      const upNext = fresh[0] ?? null
      return upNext ? callTicket(upNext.id, counterId!) : null
    },
    onSuccess: (ticket) => {
      setCurrent(ticket)
      setNote('')
      setReporting(false)
      void refresh()
    },
    onError: () => {
      setCurrent(null)
      setNote('')
      setReporting(false)
      void refresh()
    },
  })

  const errorMessage = actionErrorMessage(advance.error)

  return (
    <Screen
      title={assigned?.service_name ?? 'Visitor queue'}
      description="Who you're with, and who's next."
    >
      <AsyncBoundary
        isPending={assignment.isPending}
        error={assignment.error}
        isEmpty={assigned == null}
        emptyMessage="Your manager hasn't put you on a counter yet. Ask them to assign you to a service."
        forbiddenMessage="Assignments are read by the signed-in agent only."
        onRetry={() => void assignment.refetch()}
      >
        <Panel as="section" glow>
          <PanelBody className="flex flex-col items-center gap-6 py-12 text-center">
            <div>
              <p className="text-ink-3 text-xs font-semibold tracking-wide uppercase">
                Now serving
              </p>
              {current ? (
                <>
                  <p className="text-ink tabular mt-2 text-3xl font-bold">
                    {current.ticket_number}
                  </p>
                  <p className="text-ink-2 mt-1 text-lg">{current.visitor_name}</p>
                </>
              ) : (
                <p className="text-ink-2 mt-2 text-lg">Nobody yet</p>
              )}
            </div>

            {current && reporting && (
              <div className="w-full max-w-sm text-left">
                <Field
                  id="notes"
                  label="What went wrong"
                  hint="Required. This is the only record of why the visit did not finish."
                >
                  {(props) => (
                    <textarea
                      {...props}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Papers incomplete, system error, wrong branch"
                      rows={3}
                    />
                  )}
                </Field>
              </div>
            )}

            {errorMessage && (
              <p role="alert" className="text-warn text-sm">
                {errorMessage}
              </p>
            )}

            {/* Three states, one at a time. Nobody at the counter yet: call
                someone. Serving: say how it went. Reporting a problem: say
                what went wrong, or back out of having pressed it. */}
            {!current ? (
              <Button
                variant="primary"
                disabled={!next || advance.isPending}
                onClick={() => advance.mutate(null)}
              >
                Call next
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : reporting ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  disabled={note.trim() === '' || advance.isPending}
                  onClick={() => advance.mutate({ outcome: 'PROBLEM', notes: note.trim() })}
                >
                  Record problem
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  disabled={advance.isPending}
                  onClick={() => {
                    setReporting(false)
                    setNote('')
                  }}
                >
                  Back
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  disabled={advance.isPending}
                  onClick={() => advance.mutate({ outcome: 'SUCCESS' })}
                >
                  <Check className="size-4" aria-hidden />
                  Done
                </Button>
                <Button
                  variant="ghost"
                  disabled={advance.isPending}
                  onClick={() => setReporting(true)}
                >
                  <TriangleAlert className="size-4" aria-hidden />
                  Problem
                </Button>
              </div>
            )}

            {current && !reporting && (
              /* Says where the Next button went. Both buttons advance the
                 queue; only the outcome they record differs. */
              <p className="text-ink-3 text-xs">
                Either one finishes this ticket and calls the next person.
              </p>
            )}
          </PanelBody>
        </Panel>

        {/* Read-only on purpose - this is visibility, not a second way to work
            the queue. Only Next moves the line; jumping ahead from here would
            give an agent a control the board's Call button already owns. */}
        <Panel as="section" className="mt-4">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">Behind them</h2>
              <span className="text-ink-3 tabular text-xs">
                {waiting.length} {waiting.length === 1 ? 'person' : 'people'}
              </span>
            </div>
          </PanelHeader>
          <AsyncBoundary
            isPending={queue.isPending}
            error={queue.error}
            isEmpty={waiting.length === 0}
            emptyMessage="Nobody else is waiting for this service."
            onRetry={() => void queue.refetch()}
          >
            <PanelBody className="space-y-2">
              {waiting.map((ticket, index) => (
                <div
                  key={ticket.id}
                  className="border-line flex items-center gap-3 rounded-lg border px-4 py-3"
                >
                  <span className="text-ink-3 tabular w-5 shrink-0 text-sm">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-ink tabular text-sm font-medium">
                        {ticket.ticket_number}
                      </span>
                      <span className="text-ink truncate text-sm">{ticket.visitor_name}</span>
                    </div>
                    <p className="text-ink-3 mt-0.5 text-xs">
                      Arrived <Clock iso={ticket.created_at} />
                    </p>
                  </div>
                </div>
              ))}
            </PanelBody>
          </AsyncBoundary>
        </Panel>
      </AsyncBoundary>
    </Screen>
  )
}
