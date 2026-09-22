import { registerMock, registerMockWriter } from '../registry'
import type { CameraZone, CameraZoneCreate } from '@/api/types'
import { ApiError } from '@/api/errors'
import * as cameras from '../cameraStore'
import * as store from '../zoneStore'
import { requestUser } from '../currentUser'

/**
 * PROPOSED - GET/POST /api/zones and DELETE /api/zones/{name}, see
 * api/endpoints/zones.ts. Field names from contracts/ai-service.md §/zoning;
 * `camera_id` is the one field that is ours rather than the AI service's,
 * because the browser speaks our camera UUIDs and the AI service speaks the
 * names the backend registered them under.
 *
 * SCOPING IS THE INTERESTING PART, and it is a claim about what the backend
 * proxy should do rather than a transcription of something that exists.
 *
 * The AI service has no notion of an agency at all - one site, one flat zone
 * store, no owner on a zone. Our backend does, and the only thing tying a
 * zone to a branch is the camera it was drawn on. So this answers a MANAGER
 * with the zones on their own branch's cameras and nothing else, and refuses
 * a write against another branch's camera with the 403 cameras.py already
 * answers ("Acces limite a votre agence"). If backend proxies these routes
 * without that filter, every manager will see every branch's zones - which
 * is why it is written down here and in BACKEND-ASKS.md §8a rather than
 * left to be discovered.
 *
 * A zone whose `camera_id` is null - the proxy could not match the AI
 * service's camera name to any camera row - belongs to no branch, so only an
 * ADMIN sees it. It is not nothing: a renamed camera produces exactly that.
 */

function agencyOfCamera(cameraId: string): string | null {
  try {
    return cameras.getCamera(cameraId).agency_id
  } catch {
    return null
  }
}

function ensureCameraScope(cameraId: string): void {
  const user = requestUser()
  const agencyId = agencyOfCamera(cameraId)
  if (agencyId === null) throw new ApiError('http', 'Camera introuvable', 404)
  if (!user || user.role === 'ADMIN') return
  if (user.agency_id !== agencyId) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
}

function visibleZones(): CameraZone[] {
  const user = requestUser()
  const all = store.listZones()
  if (!user || user.role === 'ADMIN') return all
  return all.filter(
    (zone) => zone.camera_id !== null && agencyOfCamera(zone.camera_id) === user.agency_id,
  )
}

registerMock<CameraZone[]>('GET /api/zones', {
  normal: visibleZones,
  empty: () => [],
  large: visibleZones,
})

registerMockWriter('POST /api/zones', (body) => {
  const payload = body as CameraZoneCreate
  ensureCameraScope(payload.camera_id)
  return store.createZone(payload)
})

registerMockWriter('DELETE /api/zones/{name}', (_body, path) => {
  const parts = path.split('/').filter(Boolean)
  const name = decodeURIComponent(parts[parts.length - 1] ?? '')
  const zone = store.listZones().find((z) => z.name === name)
  if (!zone) throw new ApiError('http', 'Zone introuvable', 404)
  /* A zone the proxy could not attach to a camera has no branch to check,
     so only the role rule applies - and that is ADMIN and MANAGER already. */
  if (zone.camera_id !== null) ensureCameraScope(zone.camera_id)
  store.deleteZone(name)
  return undefined
})
