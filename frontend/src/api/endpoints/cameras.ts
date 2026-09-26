import { fetchJson } from '../client'
import type { Camera, CameraCreate, CameraUpdate } from '../types'

/**
 * Camera endpoints — contracts/api.md §11, added 2026-09-12.
 *
 * ADMIN, MANAGER and SECURITY throughout, except delete, which drops SECURITY.
 * There is no "every camera" list: only per agency, so an ADMIN has to say
 * which branch, the same as services. A non-ADMIN asking about a branch other
 * than their own gets a 403 ("Acces limite a votre agence"), and a camera id
 * that belongs elsewhere gets the same.
 */

export function fetchCameras(agencyId: string, signal?: AbortSignal): Promise<Camera[]> {
  return fetchJson<Camera[]>(
    {
      key: 'GET /api/agencies/{id}/cameras',
      path: `/api/agencies/${agencyId}/cameras`,
      auth: true,
    },
    { signal },
  )
}

/**
 * 409 when `name` is already taken - by any camera at any branch, since the
 * AI service's source registry is site-wide. 422 when either field is blank
 * after trimming.
 */
export function createCamera(
  agencyId: string,
  body: CameraCreate,
  signal?: AbortSignal,
): Promise<Camera> {
  return fetchJson<Camera>(
    {
      key: 'POST /api/agencies/{id}/cameras',
      path: `/api/agencies/${agencyId}/cameras`,
      method: 'POST',
      auth: true,
    },
    { signal, body },
  )
}

/** Same refusals as create. Only the fields sent are changed. */
export function updateCamera(
  id: string,
  body: CameraUpdate,
  signal?: AbortSignal,
): Promise<Camera> {
  return fetchJson<Camera>(
    { key: 'PUT /api/cameras/{id}', path: `/api/cameras/${id}`, method: 'PUT', auth: true },
    { signal, body },
  )
}

/** ADMIN and MANAGER only. 204, no body. */
export function deleteCamera(id: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    { key: 'DELETE /api/cameras/{id}', path: `/api/cameras/${id}`, method: 'DELETE', auth: true },
    { signal },
  )
}

/**
 * The current picture from one camera, as image bytes -
 * GET /api/agencies/{agency_id}/ai/frame?camera=<name>&format=jpeg&quality=N,
 * backend/app/api/ai_calibration.py (PR #109). Not in contracts/api.md yet;
 * transcribed from that backend source.
 *
 * The gateway forwards the AI service's GET /frame?camera= (ai-service.md,
 * App-level), which looks the camera up by the NAME backend registered it
 * under and returns the frame at the size the detectors see - so alert boxes
 * drawn in its pixels line up, and calibration points clicked on it are
 * sent with that same size as `img_w`/`img_h`, which the AI service records
 * as `calib_res` precisely so a calibration survives a later rescale.
 * `quality` here is the JPEG encoder's 1-100, not the camera's scale.
 *
 * ADMIN and MANAGER only. The gateway lives beside calibration and shares its
 * role list, so SECURITY - who can open the live view - is refused a picture
 * with a 403. Screens show that as a refusal, not as a dead camera.
 *
 * 404 when the camera is not in this agency, or the AI service cannot open
 * its stream; 422 when the camera row has no stream URL.
 */
export function fetchCameraFrame(
  camera: Pick<Camera, 'agency_id' | 'name'>,
  signal?: AbortSignal,
): Promise<Blob> {
  const query = new URLSearchParams({ camera: camera.name, format: 'jpeg', quality: '75' })
  return fetchJson<Blob>(
    {
      key: 'GET /api/agencies/{id}/ai/frame',
      path: `/api/agencies/${camera.agency_id}/ai/frame?${query}`,
      auth: true,
    },
    { signal, responseType: 'blob' },
  )
}
