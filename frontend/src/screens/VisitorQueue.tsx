import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, PhoneCall, Plus, X } from 'lucide-react'
import { createVisitor } from '@/api/endpoints/visitors'
import {
  callTicket,
  cancelTicket,
  completeTicket,
  createTicket,
  fetchQueue,
} from '@/api/endpoints/tickets'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { ApiError, describeApiError } from '@/api/errors'
import type { Ticket } from '@/api/types'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { Clock } from '@/components/ui/Time'
import { VisitorForm, type VisitorFormValues } from './VisitorForm'
import { Screen } from './Screen'

/**
 * The visitor queue: who is waiting, and who is at a counter right now.
 *
 * ADMIN, MANAGER and AGENT. SECURITY can register a visitor but cannot touch
 * tickets at all, so it sees the refusal state here.
 *
 * THE LIMITATION WORTH KNOWING BEFORE READING ANY OF THIS
 *
 * GET /api/tickets/queue returns only WAITING tickets. There is no endpoint
 * that lists called ones. So "at a counter" below is held in this component's
 * state, populated from the response to the call that put it there - and a page
 * reload empties it. The tickets are not lost; the server still has them, and
 * completing or cancelling still works if you kept the tab open. But whoever is
 * at a counter becomes invisible after a refresh.
 *
 * That is stated on the screen rather than hidden, because a queue display that
 * quietly forgets people is worse than one that admits it. Fixing it properly
 * needs a backend route that lists non-waiting tickets.
 *
 * There is also no WebSocket for tickets, so the queue polls. Ten seconds is a
 * compromise: a person who has just walked in should appear before the receptionist
 * wonders whether the screen is broken, without hammering the API all day.
 */

const POLL_MS = 10_000

function actionErrorMessage(error: unknown): string | null {
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

export default function VisitorQueue() {
  const { user } = useSession()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const queue = useQuery({
    queryKey: ['tickets', 'queue'],
    queryFn: ({ signal }) => fetchQueue(undefined, signal),
    refetchInterval: POLL_MS,
  })

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
  })

  /* See the note at the top: the server will not tell us these, so we remember
     them ourselves and are honest that a reload clears them. */
  const [atCounter, setAtCounter] = useState<Ticket[]>([])
  const [registering, setRegistering] = useState(false)
  const [callingId, setCallingId] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tickets', 'queue'] })

  /* Counters live nested inside their agency and nowhere else. A MANAGER or
     AGENT gets exactly one agency back, so this resolves to their own. */
  const counters = useMemo(() => {
    const list = agencies.data ?? []
    const mine = isAdmin ? list : list.filter((a) => a.id === user?.agency_id)
    return (mine[0]?.counters ?? []).slice().sort((a, b) => a.number - b.number)
  }, [agencies.data, isAdmin, user?.agency_id])

  const register = useMutation({
    /* Two requests, one button. The visitor must exist before a ticket can
       reference them, so these cannot be parallel. */
    mutationFn: async (values: VisitorFormValues) => {
      const visitor = await createVisitor({
        full_name: values.full_name.trim(),
        phone: values.phone.trim() || null,
        identity_reference: values.identity_reference.trim() || null,
        ...(isAdmin ? { agency_id: values.agency_id } : {}),
      })
      return createTicket({
        visitor_id: visitor.id,
        service_id: values.service_id,
      })
    },
    onSuccess: async () => {
      await refresh()
      setRegistering(false)
    },
  })

  const call = useMutation({
    mutationFn: ({ id, counterId }: { id: string; counterId: string }) => callTicket(id, counterId),
    onSuccess: async (ticket) => {
      setAtCounter((current) => [...current, ticket])
      setCallingId(null)
      await refresh()
    },
    onError: () => void refresh(),
  })

  const finish = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'complete' | 'cancel' }) =>
      action === 'complete' ? completeTicket(id) : cancelTicket(id),
    onSuccess: async (ticket) => {
      setAtCounter((current) => current.filter((t) => t.id !== ticket.id))
      await refresh()
    },
    onError: () => void refresh(),
  })

  const waiting = queue.data ?? []
  const actionError = actionErrorMessage(call.error ?? finish.error)
  const counterName = (id: string | null) => {
    const found = counters.find((c) => c.id === id)
    return found ? (found.name ?? `Counter ${found.number}`) : 'a counter'
  }

  return (
    <Screen
      title="Visitor queue"
      description="Who is waiting, in the order they arrived."
      actions={
        <Button variant="primary" size="sm" onClick={() => setRegistering(true)}>
          <Plus className="size-3.5" aria-hidden />
          Register visitor
        </Button>
      }
    >
      {atCounter.length > 0 && (
        <Panel as="section" className="mb-4">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">At a counter</h2>
              <span className="text-ink-3 text-xs">Cleared if you reload this page</span>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-2">
            {atCounter.map((ticket) => (
              <div
                key={ticket.id}
                className="border-line bg-panel-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-ink tabular text-sm font-medium">
                      {ticket.ticket_number}
                    </span>
                    <span className="text-ink truncate text-sm">{ticket.visitor_name}</span>
                  </div>
                  <p className="text-ink-3 mt-0.5 text-xs">
                    At {counterName(ticket.counter_id)}
                    {ticket.called_at && (
                      <>
                        {' · called '}
                        <Clock iso={ticket.called_at} />
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={finish.isPending}
                    onClick={() => finish.mutate({ id: ticket.id, action: 'complete' })}
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    disabled={finish.isPending}
                    onClick={() => finish.mutate({ id: ticket.id, action: 'cancel' })}
                    aria-label={`Cancel ${ticket.ticket_number}`}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>
      )}

      <AsyncBoundary
        isPending={queue.isPending}
        error={queue.error}
        isEmpty={waiting.length === 0}
        emptyMessage="Nobody is waiting. Register a visitor when someone arrives."
        forbiddenMessage="The queue is handled by agents, managers and administrators. Security accounts can register visitors but not issue tickets."
        onRetry={() => void queue.refetch()}
        skeletonRows={5}
      >
        <Panel as="section">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">Waiting</h2>
              <span className="text-ink-3 tabular text-xs">
                {waiting.length} {waiting.length === 1 ? 'person' : 'people'}
              </span>
            </div>
          </PanelHeader>

          {actionError && (
            <div className="border-line border-b px-5 py-3">
              <p role="alert" className="text-warn text-sm">
                {actionError}
              </p>
            </div>
          )}

          <PanelBody className="space-y-2">
            {waiting.map((ticket, index) => (
              <div
                key={ticket.id}
                className="border-line hover:bg-panel-2/60 ease-soft rounded-lg border px-4 py-3 transition-colors duration-150"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Position, not ticket number - "third in line" is the thing
                        a waiting person actually wants to know. */}
                    <span className="text-ink-3 tabular w-5 shrink-0 text-sm">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-ink tabular text-sm font-medium">
                          {ticket.ticket_number}
                        </span>
                        <span className="text-ink truncate text-sm">{ticket.visitor_name}</span>
                        {(ticket.service_name ?? ticket.service_type) && (
                          <Badge tone="neutral">{ticket.service_name ?? ticket.service_type}</Badge>
                        )}
                      </div>
                      <p className="text-ink-3 mt-0.5 text-xs">
                        Arrived <Clock iso={ticket.created_at} />
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-1.5">
                    {callingId === ticket.id ? (
                      <>
                        {/* Counters are a short, fixed list, so buttons beat a
                            dropdown - one click instead of three, which matters
                            at a desk with someone standing in front of you. */}
                        {counters.map((counter) => {
                          /* A ticket with a service can only be called to the
                             one counter assigned to that exact service - the
                             backend checks counter.service_id against the
                             ticket's, not just a matching point_type, and
                             refuses everything else with a 422. */
                          const wrongService =
                            ticket.service_id !== null && counter.service_id !== ticket.service_id
                          const disabled = !counter.is_open || wrongService || call.isPending
                          const reason = !counter.is_open
                            ? 'This counter is closed'
                            : wrongService
                              ? 'Not assigned to this ticket’s service'
                              : undefined
                          return (
                            <Button
                              key={counter.id}
                              size="sm"
                              variant={disabled ? 'secondary' : 'primary'}
                              disabled={disabled}
                              title={reason}
                              onClick={() => call.mutate({ id: ticket.id, counterId: counter.id })}
                            >
                              {counter.name ?? `Counter ${counter.number}`}
                            </Button>
                          )
                        })}
                        <Button size="sm" onClick={() => setCallingId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={counters.length === 0}
                          title={
                            counters.length === 0
                              ? 'This branch has no counters configured'
                              : undefined
                          }
                          onClick={() => setCallingId(ticket.id)}
                        >
                          <PhoneCall className="size-3.5" aria-hidden />
                          Call
                        </Button>
                        <Button
                          size="sm"
                          disabled={finish.isPending}
                          onClick={() => finish.mutate({ id: ticket.id, action: 'cancel' })}
                          aria-label={`Cancel ${ticket.ticket_number}`}
                        >
                          <X className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>
      </AsyncBoundary>

      <p className="text-ink-3 mt-4 flex items-start gap-2 text-xs leading-relaxed">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          The queue refreshes every {POLL_MS / 1000} seconds. Visitors called to a counter are
          tracked by this browser tab only — the API has no route that lists them, so reloading
          clears the panel above. The tickets themselves are unaffected.
        </span>
      </p>

      <Dialog
        open={registering}
        title="Register visitor"
        description="Adds them to the queue and issues a ticket number."
        onClose={() => {
          setRegistering(false)
          register.reset()
        }}
      >
        {registering && (
          <VisitorForm
            agencies={agencies.data ?? []}
            defaultAgencyId={user?.agency_id ?? null}
            canChooseAgency={isAdmin}
            pending={register.isPending}
            error={register.error}
            onCancel={() => {
              setRegistering(false)
              register.reset()
            }}
            onSubmit={(values) => register.mutate(values)}
          />
        )}
      </Dialog>
    </Screen>
  )
}
