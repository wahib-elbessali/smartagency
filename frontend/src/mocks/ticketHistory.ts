import type { Ticket } from '@/api/types'
import { requestUser } from './currentUser'
import { AGENCY_ID, AGENCY_ID_RABAT } from './fixtures/people'
import { getService, SERVICE_ID_CNS, SERVICE_ID_OUV, SERVICE_ID_VIR } from './serviceStore'
import { COUNTERS, listAllTickets } from './ticketStore'

/**
 * A week of finished tickets for the PROPOSED `GET /api/tickets` history route.
 *
 * The live ticketStore only holds today's four waiting tickets, which is the
 * right fixture for a queue and a useless one for statistics: a served rate
 * over four unserved tickets is 0%, and an hourly chart of four arrivals has
 * no shape. So the history is generated here and the store's tickets are
 * appended on top - calling someone on the queue screen still moves the
 * numbers.
 *
 * DETERMINISTIC, seeded per day. A random fixture makes a screenshot that
 * cannot be reproduced and a test that passes on Tuesday. The same day always
 * produces the same tickets; only "now" moves, which is what turns today's
 * late arrivals from WAITING into CALLED into COMPLETED as the clock runs.
 *
 * Weekends are closed - zero tickets, not missing data. A chart that shows two
 * empty days is honest about how a branch actually runs, and it is the case
 * most likely to render badly.
 */

const DAYS = 7

/** mulberry32 - small, fast, and good enough to make fixtures look organic. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* Two humps, late morning and after lunch, which is what a bank branch looks
   like. Hours are 8:00 to 16:00; the weight is per hour slot. */
const HOUR_WEIGHTS: Array<[number, number]> = [
  [8, 3],
  [9, 6],
  [10, 9],
  [11, 8],
  [12, 4],
  [13, 3],
  [14, 7],
  [15, 6],
]

const NAMES = [
  'Rachid El Fassi',
  'Salma Bennani',
  'Youssef Amrani',
  'Khadija Moussaoui',
  'Omar Tazi',
  'Imane Chraibi',
  'Hamza Berrada',
  'Nadia Alaoui',
  'Mehdi Idrissi',
  'Sara Lahlou',
  'Karim Benjelloun',
  'Fatima Zahra Naciri',
]

interface AgencyProfile {
  agencyId: string
  /** Clients on a full weekday. */
  volume: number
  /** service id (or null for a ticket with no service) and its share. */
  mix: Array<[string | null, number]>
  /** Free-text `service_type` used when the ticket has no service. */
  freeText: string
  counterFor: (serviceId: string | null) => string
}

const PROFILES: AgencyProfile[] = [
  {
    agencyId: AGENCY_ID,
    volume: 64,
    mix: [
      [SERVICE_ID_VIR, 0.58],
      [SERVICE_ID_OUV, 0.22],
      [SERVICE_ID_CNS, 0.12],
      [null, 0.08],
    ],
    freeText: 'Renseignements',
    counterFor: (serviceId) =>
      serviceId === SERVICE_ID_OUV
        ? COUNTERS[2].id
        : serviceId === SERVICE_ID_VIR
          ? COUNTERS[0].id
          : COUNTERS[1].id,
  },
  /* Rabat has no services in the fixtures, so every ticket there is the
     nullable-service case: labelled by its free-text service_type alone. */
  {
    agencyId: AGENCY_ID_RABAT,
    volume: 28,
    mix: [[null, 1]],
    freeText: 'Opérations courantes',
    counterFor: () => 'c2000000-0000-4000-8000-000000000001',
  },
]

function pick<T>(items: Array<[T, number]>, r: number): T {
  const total = items.reduce((n, [, w]) => n + w, 0)
  let cursor = r * total
  for (const [item, weight] of items) {
    cursor -= weight
    if (cursor <= 0) return item
  }
  return items[items.length - 1][0]
}

function stamp(day: Date): string {
  return `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
}

function ticketsForDay(day: Date, profile: AgencyProfile, now: Date, factor: number): Ticket[] {
  const weekday = day.getDay()
  if (weekday === 0 || weekday === 6) return []

  const agencyIndex = PROFILES.indexOf(profile)
  const random = rng(Number(stamp(day)) * 7 + agencyIndex)
  const count = Math.round(profile.volume * factor * (0.8 + random() * 0.4))

  const numbering = new Map<string, number>()
  const out: Ticket[] = []

  for (let i = 0; i < count; i += 1) {
    const hour = pick(HOUR_WEIGHTS, random())
    const created = new Date(day)
    created.setHours(hour, Math.floor(random() * 60), Math.floor(random() * 60), 0)
    /* Today stops at now - a ticket from the future is the one thing a
       fixture must never produce. */
    if (created > now) continue

    const serviceId = pick(profile.mix, random())
    const service = serviceId ? getService(serviceId) : null
    const code = service?.code ?? 'GEN'
    const n = (numbering.get(code) ?? 0) + 1
    numbering.set(code, n)

    /* Waits stretch at the peaks, and account openings take longest at the
       desk - the two shapes a manager would expect to recognise. */
    const peak = hour === 10 || hour === 11 || hour === 14
    const waitMin = 2 + random() * (peak ? 30 : 14)
    const serviceMin =
      serviceId === SERVICE_ID_OUV ? 14 + random() * 26 : 3 + random() * (serviceId ? 12 : 6)
    const calledAt = new Date(created.getTime() + waitMin * 60_000)
    const completedAt = new Date(calledAt.getTime() + serviceMin * 60_000)
    /* Walk-outs happen to the people who waited longest. */
    const cancelled = random() < (peak ? 0.11 : 0.04)

    let status: Ticket['status']
    let called: Date | null = null
    let completed: Date | null = null
    if (cancelled) {
      status = calledAt > now ? 'WAITING' : 'CANCELLED'
    } else if (calledAt > now) {
      status = 'WAITING'
    } else if (completedAt > now) {
      status = 'CALLED'
      called = calledAt
    } else {
      status = 'COMPLETED'
      called = calledAt
      completed = completedAt
    }

    const visitor = Math.floor(random() * 1e6)
    const id = `h${agencyIndex}${stamp(day)}-0000-4000-8000-${String(i).padStart(12, '0')}`
    out.push({
      id,
      visitor_id: `vh${agencyIndex}${String(visitor).padStart(6, '0')}-0000-4000-8000-000000000000`,
      visitor_name: NAMES[visitor % NAMES.length],
      agency_id: profile.agencyId,
      service_id: service?.id ?? null,
      service_code: service?.code ?? null,
      service_name: service?.name ?? null,
      counter_id: called ? profile.counterFor(serviceId) : null,
      ticket_number: `${stamp(day)}-${code}-${String(n).padStart(3, '0')}`,
      service_type: service?.name ?? profile.freeText,
      status,
      created_at: created.toISOString(),
      called_at: called?.toISOString() ?? null,
      completed_at: completed?.toISOString() ?? null,
      notes: null,
    })
  }

  return out
}

/** The whole week up to `now`, every agency, plus the live store on top. */
export function ticketHistory(now = new Date(), factor = 1): Ticket[] {
  const generated: Ticket[] = []
  for (let back = DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - back)
    for (const profile of PROFILES) generated.push(...ticketsForDay(day, profile, now, factor))
  }
  return [...generated, ...listAllTickets()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )
}

/**
 * What the route is expected to do with the rows: the `?from=&to=` window,
 * [from, to) on `created_at`, and the same scoping as the queue - a non-ADMIN
 * sees their own agency only. This layer stands in for the backend, so the
 * scoping belongs here and the screen must not depend on doing it itself.
 */
export function withinWindow(tickets: Ticket[], path: string): Ticket[] {
  const query = new URLSearchParams(path.split('?')[1] ?? '')
  const from = query.get('from')
  const to = query.get('to')
  const user = requestUser()
  const agencyId = user && user.role !== 'ADMIN' ? user.agency_id : null
  return tickets.filter(
    (t) =>
      (!from || t.created_at >= from) &&
      (!to || t.created_at < to) &&
      (!agencyId || t.agency_id === agencyId),
  )
}
