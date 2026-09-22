import { registerMock, registerMockWriter } from '../registry'
import type { CalibrationRectRequest, CameraCalibration, SharedPoint } from '@/api/types'
import { ApiError } from '@/api/errors'
import * as cameras from '../cameraStore'
import * as store from '../calibrationStore'
import { requestUser } from '../currentUser'

/**
 * PROPOSED - the /api/calibration routes, see api/endpoints/calibration.ts.
 *
 * Scoped through the camera, like zones: the AI service knows nothing about
 * agencies, so the proxy is what keeps one branch's geometry out of
 * another's list. A calibration whose camera has since been deleted is
 * dropped from a non-admin's view rather than shown unattributed.
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

function visible(): CameraCalibration[] {
  const user = requestUser()
  const all = store.listCalibration()
  if (!user || user.role === 'ADMIN') return all
  return all.filter((entry) => agencyOfCamera(entry.camera_id) === user.agency_id)
}

registerMock<CameraCalibration[]>('GET /api/calibration', {
  normal: visible,
  empty: () => [],
  large: visible,
})

registerMockWriter('POST /api/calibration/rect', (body) => {
  const payload = body as CalibrationRectRequest
  ensureCameraScope(payload.camera_id)
  return store.calibrateRect(payload)
})

registerMockWriter('POST /api/calibration/align', (body) => {
  const payload = body as { points: SharedPoint[] }
  /* Every camera named in a shared point has to be one the caller may
     touch - alignment rewrites the geometry of all of them at once. */
  for (const point of payload.points ?? []) {
    for (const cameraId of Object.keys(point)) ensureCameraScope(cameraId)
  }
  return store.alignCameras(payload.points ?? [])
})

registerMockWriter('DELETE /api/calibration/{id}', (_body, path) => {
  const parts = path.split('/').filter(Boolean)
  const cameraId = parts[parts.length - 1] ?? ''
  ensureCameraScope(cameraId)
  store.deleteCalibration(cameraId)
  return undefined
})
