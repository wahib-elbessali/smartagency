import { registerMock } from '../registry'
import type { SensorReading } from '@/api/types'
import { ApiError } from '@/api/errors'
import * as deviceStore from '../deviceStore'
import * as store from '../readingStore'
import { requestUser } from '../currentUser'

/**
 * PROPOSED - GET /api/devices/{id}/readings, see api/types.ts. Field names
 * from the SensorReading model in backend/app/models/entities.py.
 *
 * Scoped like the device routes it would sit beside (devices.py's
 * ensure_agency_scope): a non-ADMIN asking about a device in another branch
 * gets a 403. Read-only - no writer, because nothing in a browser records a
 * reading.
 */

/**
 * The first endpoint in this layer with a query string, so the first to have
 * to take it apart: `/api/devices/{id}/readings?sensor_type=..&limit=..`.
 * The device id is the segment before `readings`; the filters come from the
 * search part, the same two names the proposed route takes.
 */
function parse(path: string): { deviceId: string; sensorType?: string; limit?: number } {
  const [pathname, search = ''] = path.split('?')
  const parts = pathname.split('/').filter(Boolean)
  const params = new URLSearchParams(search)
  const limit = params.get('limit')
  return {
    deviceId: parts[parts.length - 2] ?? '',
    sensorType: params.get('sensor_type') ?? undefined,
    limit: limit === null ? undefined : Number(limit),
  }
}

function scoped(path: string): SensorReading[] {
  const { deviceId, sensorType, limit } = parse(path)
  const device = deviceStore.getDevice(deviceId)
  const user = requestUser()
  if (user && user.role !== 'ADMIN' && user.agency_id !== device.agency_id) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
  return store.listReadings(deviceId, { sensorType, limit })
}

registerMock<SensorReading[]>('GET /api/devices/{id}/readings', {
  normal: scoped,
  empty: () => [],
  large: scoped,
})
