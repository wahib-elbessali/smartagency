import { registerMock, registerMockWriter } from '../registry'
import type { CalibrationEntry, CalibrationRectRequest, SharedPoint } from '@/api/types'
import { agencyIdFromPath, camerasByName, ensureAgencyScope } from '../aiGateway'
import { listCameras } from '../cameraStore'
import * as store from '../calibrationStore'

/**
 * GET /api/agencies/{id}/ai/calibration and POST .../calibration/rect|align -
 * backend/app/api/ai_calibration.py, reproduced check for check.
 *
 * Unlike zones, the gateway DOES narrow this read: it drops every entry whose
 * key is not one of the agency's camera names. The writes check each named
 * camera belongs to the agency - rect also that it has a stream URL - and
 * then hand the AI service the body untouched. Alignment is still site-wide
 * underneath: it re-solves every calibrated camera the AI service knows.
 */

function visible(path: string): Record<string, CalibrationEntry> {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  const names = new Set(listCameras(agencyId).map((camera) => camera.name))
  return Object.fromEntries(
    Object.entries(store.listCalibration()).filter(([name]) => names.has(name)),
  )
}

registerMock<Record<string, CalibrationEntry>>('GET /api/agencies/{id}/ai/calibration', {
  normal: visible,
  empty: (path) => {
    ensureAgencyScope(agencyIdFromPath(path))
    return {}
  },
  large: visible,
})

registerMockWriter('POST /api/agencies/{id}/ai/calibration/rect', (body, path) => {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  const payload = body as CalibrationRectRequest
  camerasByName(agencyId, [payload.camera], true)
  return store.calibrateRect(payload)
})

registerMockWriter('POST /api/agencies/{id}/ai/calibration/align', (body, path) => {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  const payload = body as { points: SharedPoint[] }
  /* Every camera named in a shared point has to be this agency's -
     alignment rewrites the geometry of all of them at once. */
  camerasByName(
    agencyId,
    (payload.points ?? []).flatMap((point) => Object.keys(point)),
  )
  return store.alignCameras(payload.points ?? [])
})
