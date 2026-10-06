import { describe, expect, it } from 'vitest'
import type { Ticket } from '@/api/types'
import {
  arrivalsByHour,
  byDay,
  byService,
  formatMinutes,
  formatRate,
  peakIndex,
  periodRange,
  totals,
} from './clientStatsSeries'

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute).toISOString()
}

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: Math.random().toString(36),
    visitor_id: 'v',
    visitor_name: 'Client',
    agency_id: 'a',
    service_id: 's',
    service_code: 'VIR',
    service_name: 'Virement',
    counter_id: null,
    ticket_number: '20260928-VIR-001',
    service_type: 'Virement',
    status: 'WAITING',
    created_at: at(28, 9),
    called_at: null,
    completed_at: null,
    notes: null,
    ...over,
  }
}

const served = (day: number, hour: number, wait: number, desk: number, over = {}) =>
  ticket({
    status: 'COMPLETED',
    created_at: at(day, hour),
    called_at: at(day, hour, wait),
    completed_at: at(day, hour, wait + desk),
    ...over,
  })

describe('totals', () => {
  it('counts each outcome and averages wait and desk time', () => {
    const sum = totals([
      served(28, 9, 10, 5),
      served(28, 10, 20, 15),
      ticket({ status: 'CANCELLED', created_at: at(28, 11) }),
      ticket({ status: 'WAITING' }),
      ticket({ status: 'CALLED', called_at: at(28, 9, 30) }),
    ])

    expect(sum).toMatchObject({ came: 5, served: 2, left: 1, waiting: 1, atCounter: 1 })
    /* 10, 20 and the CALLED ticket's 30 - every called ticket has waited. */
    expect(sum.avgWait).toBe(20)
    /* Only completed tickets have a desk time. */
    expect(sum.avgService).toBe(10)
  })

  it('leaves open tickets out of the served rate', () => {
    const sum = totals([
      served(28, 9, 5, 5),
      served(28, 9, 5, 5),
      served(28, 9, 5, 5),
      ticket({ status: 'CANCELLED' }),
      ticket({ status: 'WAITING' }),
      ticket({ status: 'WAITING' }),
    ])
    expect(sum.servedRate).toBe(0.75)
  })

  it('has no rate or averages when nothing has finished', () => {
    const sum = totals([ticket({ status: 'WAITING' })])
    expect(sum.servedRate).toBeNull()
    expect(sum.avgWait).toBeNull()
    expect(sum.avgService).toBeNull()
  })
})

describe('byDay', () => {
  it('keeps empty days as zeros, in order', () => {
    const from = new Date(2026, 8, 26)
    const rows = byDay([served(26, 9, 5, 5), ticket({ created_at: at(28, 9) })], from, 3)

    expect(rows.map((r) => [r.came, r.served])).toEqual([
      [1, 1],
      [0, 0],
      [1, 0],
    ])
    expect(rows[0].label).toMatch(/26$/)
  })

  it('ignores tickets outside the range', () => {
    const rows = byDay([ticket({ created_at: at(20, 9) })], new Date(2026, 8, 26), 1)
    expect(rows[0].came).toBe(0)
  })
})

describe('arrivalsByHour', () => {
  it('spans first to last busy hour, filling the quiet ones', () => {
    const hours = arrivalsByHour([
      ticket({ created_at: at(28, 9) }),
      ticket({ created_at: at(28, 9, 40) }),
      ticket({ created_at: at(28, 11) }),
    ])
    expect(hours).toEqual([
      { label: '09:00', value: 2 },
      { label: '10:00', value: 0 },
      { label: '11:00', value: 1 },
    ])
  })

  it('is empty with no tickets', () => {
    expect(arrivalsByHour([])).toEqual([])
  })
})

describe('byService', () => {
  it('groups by name, then free text, then "No service", busiest first', () => {
    const rows = byService([
      ticket({ service_name: 'Ouverture' }),
      ticket({ service_name: 'Virement' }),
      ticket({ service_name: 'Virement' }),
      ticket({ service_name: null, service_type: 'Renseignements' }),
      ticket({ service_name: null, service_type: null }),
    ])
    expect(rows.map((r) => [r.label, r.came])).toEqual([
      ['Virement', 2],
      ['No service', 1],
      ['Ouverture', 1],
      ['Renseignements', 1],
    ])
  })
})

describe('helpers', () => {
  it('peakIndex picks the largest, and nothing for all zeros', () => {
    expect(peakIndex([1, 4, 2])).toBe(1)
    expect(peakIndex([0, 0])).toBeUndefined()
    expect(peakIndex([])).toBeUndefined()
  })

  it('formats minutes and rates', () => {
    expect(formatMinutes(null)).toBe('—')
    expect(formatMinutes(12.4)).toBe('12 min')
    expect(formatMinutes(65)).toBe('1 h 05')
    expect(formatRate(null)).toBe('—')
    expect(formatRate(0.876)).toBe('88%')
  })

  it('periodRange starts at local midnight, today or six days back', () => {
    const now = new Date(2026, 8, 28, 15, 30)
    expect(periodRange('today', now).from).toEqual(new Date(2026, 8, 28))
    expect(periodRange('week', now).from).toEqual(new Date(2026, 8, 22))
    expect(periodRange('week', now).to).toBe(now)
  })
})
