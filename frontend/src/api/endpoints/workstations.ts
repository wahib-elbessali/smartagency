import { fetchJson } from '../client'
import type { Workstation, WorkstationCreate } from '../types'

/**
 * Workstations - backend/app/api/employee_activity.py (PR #109). Not in
 * contracts/api.md yet; paths, bodies and statuses are transcribed from that
 * backend source.
 *
 * Unlike zones, these are rows in OUR database (the `workstations` table,
 * scoped to an agency, optionally naming the employee who should be there),
 * mirrored into the AI service's /employee_activity so it reports on them.
 * So the list comes back already filtered to the agency, and the AI
 * service's live state rides along on each row.
 *
 * Roles: reading is ADMIN, MANAGER and SECURITY; binding and unbinding are
 * ADMIN and MANAGER. A MANAGER is refused another agency with a 403.
 */

export function fetchWorkstations(agencyId: string, signal?: AbortSignal): Promise<Workstation[]> {
  return fetchJson<Workstation[]>(
    {
      key: 'GET /api/agencies/{id}/workstations',
      path: `/api/agencies/${agencyId}/workstations`,
      auth: true,
    },
    { signal },
  )
}

/**
 * Binds a name to a zone (and optionally an employee). Re-posting a name
 * this agency already has rebinds it; a name another agency uses is a 409.
 * 422 when the zone does not exist in the AI service, or the employee is
 * from another agency; 404 for an unknown employee.
 */
export function createWorkstation(
  agencyId: string,
  body: WorkstationCreate,
  signal?: AbortSignal,
): Promise<Workstation> {
  return fetchJson<Workstation>(
    {
      key: 'POST /api/agencies/{id}/workstations',
      path: `/api/agencies/${agencyId}/workstations`,
      method: 'POST',
      auth: true,
    },
    { signal, body },
  )
}

/** 204 on success, 404 when this agency has no workstation by that name. */
export function deleteWorkstation(
  agencyId: string,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  return fetchJson<void>(
    {
      key: 'DELETE /api/agencies/{id}/workstations/{name}',
      path: `/api/agencies/${agencyId}/workstations/${encodeURIComponent(name)}`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}
