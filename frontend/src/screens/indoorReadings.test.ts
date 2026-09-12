import { describe, expect, it } from 'vitest'
import type { Device, SensorReading, SensorThreshold } from '@/api/types'
import { formatReading, latestBySensor, levelFor } from './indoorReadings'

/**
 * The reduce apart from the screen: which reading counts as current, and
 * whether it is over the line. The line is the backend's (severity_for), so
 * the boundary cases are the ones worth pinning - a tile that turns warn one
 * reading later than the alert fires is the bug this file is for.
 */

function device(id: string, status: Device['status'] = 'ONLINE'): Device {
  return {
    id,
    agency_id: 'a1',
    name: `Device ${id}`,
    device_type: 'DHT22',
    mqtt_client_id: id,
    mqtt_topic: `agency/a1/device/${id}/sensor`,
    status,
    last_seen_at: null,
  }
}

function reading(
  deviceId: string,
  sensorType: string,
  value: number,
  recordedAt: string,
): SensorReading {
  return {
    id: `${deviceId}-${sensorType}-${recordedAt}`,
    device_id: deviceId,
    sensor_type: sensorType,
    value,
    unit: sensorType === 'temperature' ? 'C' : '%',
    recorded_at: recordedAt,
  }
}

function threshold(
  deviceId: string,
  sensorType: string,
  warning: number | null,
  critical: number | null,
  active = true,
): SensorThreshold {
  return {
    id: `t-${deviceId}-${sensorType}`,
    device_id: deviceId,
    sensor_type: sensorType,
    unit: null,
    warning_max: warning,
    critical_max: critical,
    is_active: active,
  }
}

describe('levelFor', () => {
  const t = threshold('d1', 'temperature', 30, 40)

  /* >= on both, the same as iot_service.severity_for - a reading exactly on
     the warning line raises the alert, so it must colour the tile too. */
  it('matches the backend boundary: at the line counts as over it', () => {
    expect(levelFor(29.9, t)).toBe('normal')
    expect(levelFor(30, t)).toBe('warning')
    expect(levelFor(39.9, t)).toBe('warning')
    expect(levelFor(40, t)).toBe('critical')
  })

  it('has no opinion without a threshold, or with an inactive one', () => {
    expect(levelFor(99, null)).toBe('unknown')
    expect(levelFor(99, threshold('d1', 'temperature', 30, 40, false))).toBe('unknown')
  })

  /* §10 allows one of the two to be null; the other still applies. */
  it('works with only one of the two limits set', () => {
    expect(levelFor(35, threshold('d1', 'temperature', null, 40))).toBe('normal')
    expect(levelFor(40, threshold('d1', 'temperature', null, 40))).toBe('critical')
    expect(levelFor(35, threshold('d1', 'temperature', 30, null))).toBe('warning')
  })
})

describe('latestBySensor', () => {
  it('takes the newest reading per sensor type, across devices', () => {
    const d1 = device('d1')
    const d2 = device('d2')
    const stats = latestBySensor(
      [d1, d2],
      {
        d1: [
          reading('d1', 'temperature', 22, '2026-09-12T10:00:00Z'),
          reading('d1', 'temperature', 21, '2026-09-12T09:55:00Z'),
          reading('d1', 'humidity', 50, '2026-09-12T10:00:00Z'),
        ],
        /* Newer than d1's, so it is the branch's temperature now. */
        d2: [reading('d2', 'temperature', 26, '2026-09-12T10:03:00Z')],
      },
      {},
    )
    expect(stats.map((s) => [s.sensorType, s.value, s.device.id])).toEqual([
      ['temperature', 26, 'd2'],
      ['humidity', 50, 'd1'],
    ])
  })

  it('pairs each reading with its own device threshold', () => {
    const d1 = device('d1')
    const stats = latestBySensor(
      [d1],
      { d1: [reading('d1', 'temperature', 31, '2026-09-12T10:00:00Z')] },
      { d1: [threshold('d1', 'temperature', 30, 40)] },
    )
    expect(stats[0].level).toBe('warning')
    expect(stats[0].threshold?.warning_max).toBe(30)
  })

  /* The contract's order, then anything else - so temperature is always the
     first tile whatever order the devices came back in. */
  it('orders by the contract sensor list, unknown types last', () => {
    const d1 = device('d1')
    const stats = latestBySensor(
      [d1],
      {
        d1: [
          reading('d1', 'pressure', 1013, '2026-09-12T10:00:00Z'),
          reading('d1', 'gas_co', 3, '2026-09-12T10:00:00Z'),
          reading('d1', 'temperature', 24, '2026-09-12T10:00:00Z'),
        ],
      },
      {},
    )
    expect(stats.map((s) => s.sensorType)).toEqual(['temperature', 'gas_co', 'pressure'])
  })

  it('is empty when nothing has reported', () => {
    expect(latestBySensor([device('d1')], { d1: [] }, {})).toEqual([])
    expect(latestBySensor([device('d1')], {}, {})).toEqual([])
  })
})

describe('formatReading', () => {
  it('writes the unit the way a person would', () => {
    expect(formatReading(24.5, 'C')).toBe('24.5°C')
    expect(formatReading(58, '%')).toBe('58%')
    expect(formatReading(12.4, 'ppm')).toBe('12.4 ppm')
    expect(formatReading(7, null)).toBe('7')
  })

  it('keeps one decimal and drops it for whole numbers', () => {
    expect(formatReading(24.56, 'C')).toBe('24.6°C')
    expect(formatReading(24, 'C')).toBe('24°C')
  })
})
