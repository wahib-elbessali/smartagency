import type { Ticket } from '@/api/types'

/**
 * Every client statistic, derived from a plain list of tickets.
 *
 * NOTHING HERE NEEDS A FIELD THE CONTRACT DOES NOT ALREADY HAVE. "Came" is a
 * ticket issued, "served" is a ticket COMPLETED, "left" is CANCELLED, the wait
 * is `called_at - created_at` and the time at the desk is
 * `completed_at - called_at`. That is why the screen asks the backend for rows
 * rather than for a summary - see endpoints/ticketHistory.ts.
 *
 * Kept out of the screen so the arithmetic is tested without mounting React,
 * the same split as presenceSeries.ts.
 */

export type Period = 'today' | 'week'

export const PERIOD_DAYS: Record<Period, number> = { today: 1, week: 7 }

/** [local midnight `days - 1` days ago, now). */
export function periodRange(period: Period, now = new Date()): { from: Date; to: Date } {
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (PERIOD_DAYS[period] - 1))
  return { from, to: now }
}

function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms / 60_000 : null
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((n, v) => n + v, 0) / values.length
}

export interface ClientTotals {
  came: number
  served: number
  /** Cancelled - most often a client who gave up waiting. */
  left: number
  waiting: number
  /** CALLED or IN_SERVICE: at a counter right now. */
  atCounter: number
  /**
   * served / (served + left). Tickets still open are left out: a client who
   * arrived two minutes ago has not been failed, and counting them would make
   * every morning look worse than every evening.
   */
  servedRate: number | null
  /** Minutes from ticket to being called, over every ticket that was called. */
  avgWait: number | null
  /** Minutes at the counter, over every completed ticket. */
  avgService: number | null
}

export function totals(tickets: Ticket[]): ClientTotals {
  let served = 0
  let left = 0
  let waiting = 0
  let atCounter = 0
  const waits: number[] = []
  const services: number[] = []

  for (const t of tickets) {
    if (t.status === 'COMPLETED') served += 1
    else if (t.status === 'CANCELLED') left += 1
    else if (t.status === 'WAITING') waiting += 1
    else atCounter += 1

    const wait = minutesBetween(t.created_at, t.called_at)
    if (wait !== null) waits.push(wait)
    if (t.status === 'COMPLETED') {
      const service = minutesBetween(t.called_at, t.completed_at)
      if (service !== null) services.push(service)
    }
  }

  const finished = served + left
  return {
    came: tickets.length,
    served,
    left,
    waiting,
    atCounter,
    servedRate: finished === 0 ? null : served / finished,
    avgWait: mean(waits),
    avgService: mean(services),
  }
}

export interface Bucket {
  label: string
  value: number
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })

/**
 * One row per calendar day in the range, oldest first - including days with no
 * tickets at all. A closed Saturday is a zero, not a gap, and dropping it would
 * put Friday and Monday side by side as if they were consecutive.
 */
export function byDay(
  tickets: Ticket[],
  from: Date,
  days: number,
): Array<{ label: string; came: number; served: number }> {
  const rows: Array<{ key: string; label: string; came: number; served: number }> = []
  const index = new Map<string, number>()

  for (let i = 0; i < days; i += 1) {
    const day = new Date(from)
    day.setDate(day.getDate() + i)
    const key = day.toDateString()
    index.set(key, rows.length)
    rows.push({ key, label: `${WEEKDAY.format(day)} ${day.getDate()}`, came: 0, served: 0 })
  }

  for (const t of tickets) {
    const row = index.get(new Date(t.created_at).toDateString())
    if (row === undefined) continue
    rows[row].came += 1
    if (t.status === 'COMPLETED') rows[row].served += 1
  }

  return rows.map(({ label, came, served }) => ({ label, came, served }))
}

/**
 * Arrivals per hour of the day, across the whole period, from the first busy
 * hour to the last. Over a week this is "when do clients come", which is the
 * staffing question; it is not a timeline.
 */
export function arrivalsByHour(tickets: Ticket[]): Bucket[] {
  const hours = tickets
    .map((t) => new Date(t.created_at).getHours())
    .filter((h) => Number.isFinite(h))
  if (hours.length === 0) return []

  const first = Math.min(...hours)
  const last = Math.max(...hours)
  const counts = new Map<number, number>()
  for (let h = first; h <= last; h += 1) counts.set(h, 0)
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1)

  return [...counts.entries()].map(([h, value]) => ({
    label: `${String(h).padStart(2, '0')}:00`,
    value,
  }))
}

/** Index of the largest bucket - the one bar that gets the accent. */
export function peakIndex(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  let best = 0
  for (let i = 1; i < values.length; i += 1) if (values[i] > values[best]) best = i
  return values[best] > 0 ? best : undefined
}

export interface ServiceRow extends ClientTotals {
  label: string
}

/**
 * Totals per service, busiest first.
 *
 * Labelled by `service_name`, then the free-text `service_type`, then "No
 * service". Both service fields are nullable on a real ticket (it predates the
 * Services contract, or its service was deleted since) and such a ticket still
 * counts - a client who came and was served is not less served for it.
 */
export function byService(tickets: Ticket[]): ServiceRow[] {
  const groups = new Map<string, Ticket[]>()
  for (const t of tickets) {
    const label = t.service_name ?? t.service_type ?? 'No service'
    const group = groups.get(label)
    if (group) group.push(t)
    else groups.set(label, [t])
  }
  return [...groups.entries()]
    .map(([label, group]) => ({ label, ...totals(group) }))
    .sort((a, b) => b.came - a.came || a.label.localeCompare(b.label))
}

/** "12 min", "1 h 05", or an em dash when there is nothing to average. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded} min`
  return `${Math.floor(rounded / 60)} h ${String(rounded % 60).padStart(2, '0')}`
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}
