import { registerMock, registerMockWriter } from '../registry'
import type { Camera, CameraCreate, CameraUpdate, WeaponThreshold } from '@/api/types'
import { ApiError } from '@/api/errors'
import * as store from '../cameraStore'
import { requestUser } from '../currentUser'

/**
 * Field names from CameraResponse / AIWeaponThresholdResponse in
 * backend/app/schemas/camera.py. contracts/api.md §11-12, added 2026-09-12.
 *
 * Agency scoping is enforced here rather than in cameraStore, for the same
 * reason agencyStore's `visibleTo` lives in its fixture file - this layer IS
 * the backend when mocks are on. cameras.py answers a non-ADMIN asking about
 * another branch with 403 "Acces limite a votre agence", on the list, the
 * create, and any camera whose agency is not theirs - so that is what these
 * do, rather than the 404 the agencies fixture uses (its route hides the
 * other branch's existence; this one does not).
 */
function ensureAgencyScope(agencyId: string): void {
  const user = requestUser()
  if (!user || user.role === 'ADMIN') return
  if (user.agency_id !== agencyId) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
}

/** For /api/agencies/{agency_id}/cameras - the id is second-to-last. */
function agencyIdFrom(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 2] ?? ''
}

function lastSegment(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function scopedList(path: string): Camera[] {
  const agencyId = agencyIdFrom(path)
  ensureAgencyScope(agencyId)
  return store.listCameras(agencyId)
}

registerMock<Camera[]>('GET /api/agencies/{id}/cameras', {
  normal: scopedList,
  empty: () => [],
  large: scopedList,
})

registerMockWriter('POST /api/agencies/{id}/cameras', (body, path) => {
  const agencyId = agencyIdFrom(path)
  ensureAgencyScope(agencyId)
  return store.createCamera(agencyId, body as CameraCreate)
})

registerMockWriter('PUT /api/cameras/{id}', (body, path) => {
  const id = lastSegment(path)
  ensureAgencyScope(store.getCamera(id).agency_id)
  return store.updateCamera(id, body as CameraUpdate)
})

registerMockWriter('DELETE /api/cameras/{id}', (_body, path) => {
  const id = lastSegment(path)
  ensureAgencyScope(store.getCamera(id).agency_id)
  store.deleteCamera(id)
  return undefined
})

/* Global, so no scoping: every branch's guard reads and writes the same one. */
registerMock<WeaponThreshold>('GET /api/ai-alerts/thresholds/weapon', {
  normal: () => store.getWeaponThreshold(),
  empty: () => store.getWeaponThreshold(),
  large: () => store.getWeaponThreshold(),
})

registerMockWriter('PUT /api/ai-alerts/thresholds/weapon', (body) =>
  store.setWeaponThreshold(body as WeaponThreshold),
)
