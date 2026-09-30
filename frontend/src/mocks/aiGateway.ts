import { ApiError } from '@/api/errors'
import type { Camera } from '@/api/types'
import { getAgency } from './agencyStore'
import { listCameras } from './cameraStore'
import { requestUser } from './currentUser'

/**
 * The checks every backend AI gateway route runs before it forwards
 * anything, reproduced once for the fixtures that stand in for them
 * (zones, calibration, the frame, workstations). Transcribed from the
 * helpers repeated at the top of backend/app/api/ai_zoning.py,
 * ai_calibration.py and employee_activity.py - same order, same statuses,
 * same French details - so a screen that handles a refusal here handles the
 * real one unchanged.
 */

/**
 * The agency id in /api/agencies/{agency_id}/..., wherever the path goes
 * after it. Query strings are not part of a segment.
 */
export function agencyIdFromPath(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean)
  return parts[2] ?? ''
}

/** The last path segment, decoded - a zone or workstation name. */
export function nameFromPath(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? '')
}

/** `_ensure_agency_scope`: 404 for an unknown agency, 403 for someone else's. */
export function ensureAgencyScope(agencyId: string): void {
  getAgency(agencyId)
  const user = requestUser()
  if (!user || user.role === 'ADMIN') return
  if (user.agency_id !== agencyId) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
}

/**
 * `_ensure_camera_names` / `_agency_cameras`: every name must be a camera of
 * THIS agency (404), and with `requireStream` each must have a stream URL
 * (422). Backend matches on the name because that is what it registered the
 * camera with the AI service under.
 */
export function camerasByName(
  agencyId: string,
  names: Iterable<string>,
  requireStream = false,
): Map<string, Camera> {
  const wanted = new Set(names)
  const found = new Map(
    listCameras(agencyId)
      .filter((camera) => wanted.has(camera.name))
      .map((camera) => [camera.name, camera]),
  )
  const missing = [...wanted].filter((name) => !found.has(name)).sort()
  if (missing.length > 0) {
    throw new ApiError(
      'http',
      `Camera(s) introuvable(s) dans cette agence: ${JSON.stringify(missing)}`,
      404,
    )
  }
  if (requireStream) {
    const withoutStream = [...found.values()]
      .filter((camera) => !camera.stream_url)
      .map((camera) => camera.name)
      .sort()
    if (withoutStream.length > 0) {
      throw new ApiError(
        'http',
        `Flux manquant pour la/les camera(s): ${JSON.stringify(withoutStream)}`,
        422,
      )
    }
  }
  return found
}
