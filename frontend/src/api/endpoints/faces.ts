import { fetchJson } from '../client'
import type { EmployeeFace } from '../types'

/**
 * Employee face enrollment - backend/app/api/face_recognition.py (PR #109),
 * in front of the AI service's /face gallery. Not in contracts/api.md yet;
 * transcribed from that backend source. ADMIN and MANAGER only; a MANAGER
 * works on their own agency's employees (403 otherwise).
 *
 * Only enrollment is here. The same router has /api/ai/face/scan and
 * /capture, but a scan belongs to an event - a door, a kiosk - that the
 * backend decides, not to a button on this dashboard, so they are left out.
 */

/** Every enrolled employee the caller may see. Not-enrolled ones are absent. */
export function fetchFaces(signal?: AbortSignal): Promise<EmployeeFace[]> {
  return fetchJson<EmployeeFace[]>(
    { key: 'GET /api/employees/faces', path: '/api/employees/faces', auth: true },
    { signal },
  )
}

/**
 * Adds one photo (exactly one face) for this employee; calling it again adds
 * another. 422 for an inactive employee or a non-image, 413 over 10 MB.
 */
export function enrollFace(
  employeeId: string,
  image: File,
  signal?: AbortSignal,
): Promise<EmployeeFace> {
  const form = new FormData()
  form.append('image', image)
  return fetchJson<EmployeeFace>(
    {
      key: 'POST /api/employees/{id}/face',
      path: `/api/employees/${employeeId}/face`,
      method: 'POST',
      auth: true,
    },
    { signal, body: form },
  )
}

/** Removes every photo enrolled for the employee. 204. */
export function deleteFace(employeeId: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    {
      key: 'DELETE /api/employees/{id}/face',
      path: `/api/employees/${employeeId}/face`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}
