import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, DoorOpen, RefreshCw, UserCheck, Users } from 'lucide-react'
import { fetchTicketHistory } from '@/api/endpoints/ticketHistory'
import { useScope, withinScope } from '@/agency/ScopeContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { BarSeries } from '@/components/charts/BarSeries'
import { Donut } from '@/components/charts/Donut'
import { Sparkline } from '@/components/charts/Sparkline'
import { seriesColor } from '@/components/charts/palette'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { cn } from '@/components/ui/cn'
import {
  arrivalsByHour,
  byDay,
  byService,
  formatMinutes,
  formatRate,
  peakIndex,
  periodRange,
  PERIOD_DAYS,
  totals,
  type Period,
} from './clientStatsSeries'
import { Screen } from './Screen'

/**
 * How many clients came, and how many were served.
 *
 * The question a branch manager asks at the end of a day or a week, and one
 * the queue screen cannot answer: `/api/tickets/queue` only ever returns
 * WAITING tickets, so a served client disappears from the frontend the moment
 * they are called. This screen reads the PROPOSED ticket history route instead
 * (endpoints/ticketHistory.ts) and derives everything from fields a Ticket
 * already has, so no number here needs a field the contract lacks.
 *
 * "Served rate" is served over FINISHED tickets, not over everyone who came -
 * someone who took a ticket two minutes ago has not been failed yet, and
 * counting them would make every busy hour look like a bad one.
 *
 * Its own screen for now, beside the visitor queue in the navigation (it may
 * yet move into the queue screen as a panel). A default export like every
 * other screen, so moving it is one lazy() line in App.tsx.
 */

const PERIOD_LABEL: Record<Period, string> = { today: 'Today', week: 'Last 7 days' }

export default function ClientStats() {
  const [period, setPeriod] = useState<Period>('today')
  const scope = useScope()

  const history = useQuery({
    queryKey: ['tickets', 'history', period],
    /* The range is computed at fetch time, not render time, so a refetch an
       hour later asks for "until now" rather than "until when the screen
       first opened". */
    queryFn: async ({ signal }) => {
      const { from, to } = periodRange(period)
      return { from, tickets: await fetchTicketHistory(from, to, signal) }
    },
    /* Today moves - people are still arriving. A week mostly does not. */
    refetchInterval: period === 'today' ? 60_000 : false,
  })

  /* Scoped once at the source, as on Employee presence: the tiles, charts and
     table all count the same tickets, so none of them can disagree. */
  const tickets = useMemo(
    () => withinScope(history.data?.tickets ?? [], scope.agencyId),
    [history.data, scope.agencyId],
  )

  const sum = useMemo(() => totals(tickets), [tickets])
  const hours = useMemo(() => arrivalsByHour(tickets), [tickets])
  const services = useMemo(() => byService(tickets), [tickets])
  const days = useMemo(
    () => (history.data ? byDay(tickets, history.data.from, PERIOD_DAYS[period]) : []),
    [tickets, history.data, period],
  )

  /* Fixed slots, not foldToPalette: these four are outcomes in a fixed order,
     and "Served" must not change colour because "Left" overtook it. */
  const outcomes = [
    { label: 'Served', value: sum.served, color: seriesColor(0) },
    { label: 'Left without service', value: sum.left, color: seriesColor(1) },
    { label: 'At a counter', value: sum.atCounter, color: seriesColor(2) },
    { label: 'Still waiting', value: sum.waiting, color: seriesColor(3) },
  ].filter((o) => o.value > 0)

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <Screen
      title="Client statistics"
      description="How many clients came, how many were served, and how long they waited."
      actions={
        <>
          <div role="group" aria-label="Period" className="flex items-center gap-1">
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={p === period ? 'primary' : 'ghost'}
                aria-pressed={p === period}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p]}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => void history.refetch()}
            aria-label="Refresh client statistics"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Refresh
          </Button>
        </>
      }
    >
      <AsyncBoundary
        isPending={history.isPending}
        error={history.error}
        isEmpty={tickets.length === 0}
        emptyMessage={
          period === 'today'
            ? 'No clients have taken a ticket today yet.'
            : 'No clients took a ticket in the last 7 days.'
        }
        /* Same roles as every ticket route: SECURITY and TECHNICIAN land here. */
        forbiddenMessage="Client statistics are visible to administrators, managers and agents. Ask an administrator if you need access."
        onRetry={() => void history.refetch()}
        skeletonRows={6}
      >
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Clients who came"
            value={sum.came}
            icon={<Users className="size-4" aria-hidden />}
            detail={
              period === 'week' && days.length > 1 ? (
                <Sparkline values={days.map((d) => d.came)} width={110} height={26} />
              ) : undefined
            }
            hint="Tickets issued"
          />
          <StatTile
            label="Served"
            value={sum.served}
            tone="ok"
            icon={<UserCheck className="size-4" aria-hidden />}
            detail={
              <p className="text-ink-3 text-xs">
                <span className="tabular text-ink-2 font-medium">{formatRate(sum.servedRate)}</span>{' '}
                of finished visits
              </p>
            }
            hint={
              sum.waiting + sum.atCounter > 0
                ? `${sum.waiting + sum.atCounter} still in progress`
                : 'Every visit is finished'
            }
          />
          <StatTile
            label="Left without service"
            value={sum.left}
            tone={sum.left > 0 ? 'warn' : 'neutral'}
            icon={<DoorOpen className="size-4" aria-hidden />}
            hint="Tickets cancelled before completion"
          />
          <StatTile
            label="Average wait"
            value={formatMinutes(sum.avgWait)}
            icon={<Clock3 className="size-4" aria-hidden />}
            hint={`Then ${formatMinutes(sum.avgService)} at the counter on average`}
          />
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
          <Panel as="section" className="lg:col-span-3">
            <PanelHeader>
              <h2 className="text-ink text-sm font-semibold">When clients arrive</h2>
              <p className="text-ink-3 mt-1 text-xs">
                Tickets issued per hour
                {period === 'week' ? ', across the whole week' : ''}. The busiest hour is
                highlighted.
              </p>
            </PanelHeader>
            <PanelBody>
              <BarSeries
                data={hours}
                litIndex={peakIndex(hours.map((h) => h.value))}
                format={(n) => plural(n, 'client', 'clients')}
                height={150}
              />
            </PanelBody>
          </Panel>

          <Panel as="section" className="lg:col-span-2">
            <PanelHeader>
              <h2 className="text-ink text-sm font-semibold">What happened to them</h2>
              <p className="text-ink-3 mt-1 text-xs">Every ticket in the period, by outcome.</p>
            </PanelHeader>
            <PanelBody>
              <Donut
                segments={outcomes}
                totalLabel="clients"
                size={148}
                /* A floor on the legend: beside a ring in a two-fifths column
                   it otherwise shrinks to one letter per label. With the floor,
                   flex-wrap drops it under the ring instead. */
                className="justify-center [&>ul]:min-w-40"
              />
            </PanelBody>
          </Panel>
        </div>

        {period === 'week' && (
          <Panel as="section" className="mb-5">
            <PanelHeader>
              <h2 className="text-ink text-sm font-semibold">Came and served, by day</h2>
              <p className="text-ink-3 mt-1 text-xs">
                The full bar is everyone who came; the lit part is who was served.
              </p>
            </PanelHeader>
            <PanelBody>
              <DayBars days={days} />
            </PanelBody>
          </Panel>
        )}

        <Panel as="section">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">By service</h2>
              <span className="text-ink-3 tabular text-xs">
                {plural(services.length, 'service', 'services')}
              </span>
            </div>
          </PanelHeader>
          <PanelBody className="px-0 py-0">
            <ServiceTable rows={services} />
          </PanelBody>
        </Panel>
      </AsyncBoundary>
    </Screen>
  )
}

/**
 * One horizontal bar per day: the track is "came", the fill is "served".
 *
 * Overlaid rather than side by side because served is a subset of came - two
 * adjacent columns would invite reading them as independent quantities, and
 * the gap between them is the number that matters. Scaled to the busiest day
 * so a quiet Monday visibly is one. A closed day keeps its row at zero.
 */
function DayBars({ days }: { days: Array<{ label: string; came: number; served: number }> }) {
  const peak = Math.max(...days.map((d) => d.came), 1)

  return (
    <ul className="space-y-2">
      {days.map((d) => (
        <li key={d.label} className="flex items-center gap-3">
          <span className="text-ink-3 w-14 shrink-0 text-xs">{d.label}</span>
          <div
            className="bg-panel-2 relative h-2.5 flex-1 overflow-hidden rounded-full"
            role="img"
            aria-label={`${d.label}: ${d.served} served of ${d.came} who came`}
          >
            <span
              className="bg-line-strong absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${(d.came / peak) * 100}%` }}
            />
            <span
              className="bg-data-lit absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${(d.served / peak) * 100}%` }}
            />
          </div>
          <span className="text-ink-2 tabular w-16 shrink-0 text-right text-xs">
            {d.came === 0 ? (
              <span className="text-ink-3">closed</span>
            ) : (
              <>
                <span className="text-ink font-medium">{d.served}</span> / {d.came}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ServiceTable({ rows }: { rows: ReturnType<typeof byService> }) {
  const cell = 'px-5 py-3 text-right tabular'
  const head = 'px-5 py-2.5 text-right font-medium'

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Clients per service, busiest first</caption>
        <thead>
          <tr className="text-ink-3 tracked border-line/70 border-b text-left text-[10px] font-medium">
            <th scope="col" className="px-5 py-2.5 font-medium">
              Service
            </th>
            <th scope="col" className={head}>
              Came
            </th>
            <th scope="col" className={head}>
              Served
            </th>
            <th scope="col" className={head}>
              Left
            </th>
            <th scope="col" className={head}>
              Served rate
            </th>
            <th scope="col" className={head}>
              Avg wait
            </th>
            <th scope="col" className={head}>
              Avg at counter
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-line/70 hover:bg-panel-2/60 ease-soft border-b transition-colors duration-150 last:border-b-0"
            >
              <th scope="row" className="text-ink px-5 py-3 text-left font-medium">
                {row.label}
              </th>
              <td className={cn(cell, 'text-ink')}>{row.came}</td>
              <td className={cn(cell, 'text-ok')}>{row.served}</td>
              <td className={cn(cell, row.left > 0 ? 'text-warn' : 'text-ink-3')}>{row.left}</td>
              <td className={cn(cell, 'text-ink-2')}>{formatRate(row.servedRate)}</td>
              <td className={cn(cell, 'text-ink-2')}>{formatMinutes(row.avgWait)}</td>
              <td className={cn(cell, 'text-ink-2')}>{formatMinutes(row.avgService)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
