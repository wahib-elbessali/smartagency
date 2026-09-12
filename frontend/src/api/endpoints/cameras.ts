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
