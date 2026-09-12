import type { SensorReading } from '@/api/types'
import { DEVICE_ID_DHT22, DEVICE_ID_RABAT_DHT22 } from './deviceStore'

/**
 * Sensor readings for mock mode - the rows iot_service writes for every
 * MQTT sensor message, PROPOSED as GET /api/devices/{id}/readings
 * (api/types.ts).
 *
 * Read-only: nothing on the dashboard writes a reading, the hardware does.
 * What matters is that the seed looks like a real afternoon rather than a
 * flat line, so the screen has something to be right about:
 *
 *   Casablanca DHT22  a reading every five minutes for the last four hours,
 *                     temperature drifting 23-27 C and humidity 52-64 %. Its
 *                     newest reading is two minutes old, matching the device's
 *                     last_seen_at, and the temperature is under the seeded
 *                     30 C warning - so the tile reads normal.
 *   Rabat DHT22       the device is in ERROR with last_seen_at six hours ago,
 *                     so its readings stop there too: an admin looking at Rabat
 *                     should see values that are visibly old, not a live-looking
 *                     number from a sensor that has stopped.
 *   PIR               reports no climate readings at all, and has none.
 *
 * Values follow the ingestion contract exactly - sensor_type is one of
 * temperature / humidity / gas_co, units are C / % / ppm (ingestion.md §4).
 */

const FIVE_MINUTES = 5 * 60_000

function series(
  deviceId: string,
  sensorType: string,
  unit: string,
  base: number,
  swing: number,
  hours: number,
  endedMinutesAgo: number,
): SensorReading[] {
  const out: SensorReading[] = []
  const end = Date.now() - endedMinutesAgo * 60_000
  const count = (hours * 60) / 5
  for (let i = 0; i < count; i += 1) {
    const at = end - i * FIVE_MINUTES
    /* A slow sine so consecutive readings are close and the whole run has one
       visible peak - a random walk would jitter, and a real room does not. */
    const phase = (i / count) * Math.PI * 2
    const value = Math.round((base + swing * Math.sin(phase) + (i % 3) * 0.1) * 10) / 10
    out.push({
      id: `r1000000-0000-4000-8000-${deviceId.slice(-4)}${sensorType.slice(0, 2)}${String(i).padStart(6, '0')}`,
      device_id: deviceId,
      sensor_type: sensorType,
      value,
      unit,
      recorded_at: new Date(at).toISOString(),
    })
  }
  return out
}

let readings: SensorReading[] | null = null

function seed(): SensorReading[] {
  if (readings === null) {
    readings = [
      ...series(DEVICE_ID_DHT22, 'temperature', 'C', 25, 2, 4, 2),
      ...series(DEVICE_ID_DHT22, 'humidity', '%', 58, 6, 4, 2),
      ...series(DEVICE_ID_RABAT_DHT22, 'temperature', 'C', 27, 1.5, 4, 6 * 60),
      ...series(DEVICE_ID_RABAT_DHT22, 'humidity', '%', 49, 4, 4, 6 * 60),
    ]
  }
  return readings
}

/** Newest first, as the proposed route answers. */
export function listReadings(
  deviceId: string,
  query: { sensorType?: string; limit?: number } = {},
): SensorReading[] {
  const rows = seed()
    .filter((r) => r.device_id === deviceId)
    .filter((r) => query.sensorType === undefined || r.sensor_type === query.sensorType)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    .map((r) => ({ ...r }))
  return query.limit === undefined ? rows : rows.slice(0, query.limit)
}

/** Tests only - the seed is time-relative, so a long test would otherwise age it. */
export function resetReadingStore(): void {
  readings = null
}
