import { fetchJson } from '../client'
import type { SensorReading } from '../types'

/**
 * Sensor reading endpoints — PROPOSED, not in contracts/api.md (2026-09-12).
 *
 * The backend stores every DHT22 / MQ-7 reading (`sensor_readings`, written by
 * iot_service.process_sensor_payload) and exposes none of them. This is the
 * one route the Climate screen needs to show what it is like inside a branch
 * rather than only outside it. See the type in api/types.ts for the exact
 * shape to ask backend for; against a real server this answers 404 until it
 * lands, and the screen treats that as "no indoor readings" rather than an
 * error.
 *
 * Same roles as the device it hangs off: ADMIN, MANAGER, TECHNICIAN.
 */

export interface ReadingsQuery {
  /** One of ingestion.md's names (temperature, humidity, gas_co) - omit for all. */
  sensorType?: string
  /** Newest first, so a small limit is "the latest few". */
  limit?: number
}

export function fetchReadings(
  deviceId: string,
  query: ReadingsQuery = {},
  signal?: AbortSignal,
): Promise<SensorReading[]> {
  const params = new URLSearchParams()
  if (query.sensorType !== undefined) params.set('sensor_type', query.sensorType)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const search = params.size > 0 ? `?${params.toString()}` : ''

  return fetchJson<SensorReading[]>(
    {
      key: 'GET /api/devices/{id}/readings',
      path: `/api/devices/${deviceId}/readings${search}`,
      auth: true,
    },
    { signal },
  )
}
