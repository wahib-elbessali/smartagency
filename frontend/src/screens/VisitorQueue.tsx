import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { actionErrorMessage, fetchQueue } from '@/api/endpoints/tickets'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchServices } from '@/api/endpoints/services'
import { assignAgent, fetchAgents } from '@/api/endpoints/assignments'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { controlClass } from '@/components/ui/control'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { Screen } from './Screen'
import AgentQueue from './AgentQueue'

/**
 * The visitor queue - the ADMIN and MANAGER view.
 *
 * This used to be a working queue console: a waiting list, calling tickets to
 * counters, registering visitors. Removed (2026-09-05, at the user's
 * direction) - running the queue is AGENT's job now, done entirely in
 * `AgentQueue`. What's left here is oversight: assign each agent to a
 * counter, and see how their line is doing.
 *
 * ASSIGNMENT AND "SEEING THEIR QUEUES"
 *
 * Both PROPOSED (api/endpoints/assignments.ts) - nothing on the real backend
 * links an account to a counter yet, so this reads and writes the same mock
 * AgentQueue itself reads from. "See their queues" is a waiting count per
 * assigned service, not who they're currently with: GET /api/tickets/queue
 * only ever returns WAITING tickets (contracts/api.md §8), and "currently
 * serving" is state AgentQueue keeps in its own browser tab - nothing a
 * manager's session could read even if this screen wanted to show it.
 * Faking a live "now serving" here would be inventing data nobody has.
 *
 * A counter with no service assigned can't back an agent assignment either -
 * AgentQueue needs a service_id to know what queue to show - so those are
 * left out of the picker rather than offered as a dead end.
 */

/** Routes AGENT to its own screen; everyone else gets the board below. */
export default function VisitorQueue() {
  const { user } = useSession()
  if (user?.role === 'AGENT') return <AgentQueue />
  return <VisitorQueueBoard />
}

function VisitorQueueBoard() {
  const { user } = useSession()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
  })

  /* Counters live nested inside their agency and nowhere else. A MANAGER
     gets exactly one agency back, so this resolves to their own; an ADMIN
     resolves to the first, same as the rest of this screen always has. */
  const myAgency = useMemo(() => {
    const list = agencies.data ?? []
    const mine = isAdmin ? list : list.filter((a) => a.id === user?.agency_id)
    return mine[0] ?? null
  }, [agencies.data, isAdmin, user?.agency_id])

  const assignableCounters = useMemo(
    () =>
      (myAgency?.counters ?? [])
        .filter((c) => c.service_id != null)
        .sort((a, b) => a.number - b.number),
    [myAgency],
  )

  const services = useQuery({
    queryKey: ['services', myAgency?.id],
    queryFn: ({ signal }) => fetchServices(myAgency!.id, signal),
    enabled: myAgency != null,
  })

  const agents = useQuery({
    queryKey: ['agents', myAgency?.id],
    queryFn: ({ signal }) => fetchAgents(myAgency!.id, signal),
    enabled: myAgency != null,
  })

  /* Unfiltered - a waiting count per service, for every agent, needs every
     service's tickets regardless of which one any single agent is on. */
  const queue = useQuery({
    queryKey: ['tickets', 'queue', null],
    queryFn: ({ signal }) => fetchQueue(undefined, signal),
    refetchInterval: 10_000,
  })
  const waitingByService = (serviceId: string): number =>
    (queue.data ?? []).filter((t) => t.service_id === serviceId).length

  const assign = useMutation({
    mutationFn: ({ userId, counterId }: { userId: string; counterId: string | null }) =>
      assignAgent(userId, counterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', myAgency?.id] }),
  })
  const assignError = actionErrorMessage(assign.error)

  return (
    <Screen
      title="Visitor queue"
      description="Assign your agents, and see how each queue is doing."
    >
      <Panel as="section">
        <PanelHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-ink text-sm font-semibold">Agents</h2>
            <span className="text-ink-3 tabular text-xs">
              {(agents.data ?? []).length} {(agents.data ?? []).length === 1 ? 'agent' : 'agents'}
            </span>
          </div>
        </PanelHeader>

        {assignError && (
          <div className="border-line border-b px-5 py-3">
            <p role="alert" className="text-warn text-sm">
              {assignError}
            </p>
          </div>
        )}

        <AsyncBoundary
          isPending={agents.isPending}
          error={agents.error}
          isEmpty={(agents.data ?? []).length === 0}
          emptyMessage="No agent accounts in this branch yet."
          forbiddenMessage="Assigning agents is done by managers and administrators."
          onRetry={() => void agents.refetch()}
        >
          <PanelBody className="space-y-2">
            {(agents.data ?? []).map((agent) => (
              <div
                key={agent.user_id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-medium">{agent.full_name}</p>
                  <p className="text-ink-3 mt-0.5 text-xs">
                    {agent.assignment
                      ? `${agent.assignment.service_name} · ${agent.assignment.counter_name ?? 'a counter'}`
                      : 'Not assigned'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {agent.assignment && (
                    <span className="text-ink-3 tabular text-xs">
                      {waitingByService(agent.assignment.service_id)} waiting
                    </span>
                  )}
                  <select
                    aria-label={`Assign ${agent.full_name} to a counter`}
                    className={controlClass()}
                    value={agent.assignment?.counter_id ?? ''}
                    disabled={assign.isPending}
                    onChange={(e) =>
                      assign.mutate({ userId: agent.user_id, counterId: e.target.value || null })
                    }
                  >
                    <option value="">Not assigned</option>
                    {assignableCounters.map((counter) => (
                      <option key={counter.id} value={counter.id}>
                        {counter.name ?? `Counter ${counter.number}`} —{' '}
                        {services.data?.find((s) => s.id === counter.service_id)?.name ?? ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </PanelBody>
        </AsyncBoundary>
      </Panel>

      <p className="text-ink-3 mt-4 flex items-start gap-2 text-xs leading-relaxed">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Waiting counts refresh every 10 seconds. They don't show who an agent is currently with -
          that's tracked only in the agent's own browser tab, nowhere this screen can read it from.
        </span>
      </p>
    </Screen>
  )
}
