import { fetchJson } from '../client'
import type { Workstation, WorkstationCreate } from '../types'

/**
 * Workstations — PROPOSED, not in contracts/api.md (2026-09-19).
 *
 * contracts/ai-service.md §/employee_activity, proxied by the backend for
 * the same reason everything else AI-facing is: the browser must not reach
 * that service (repo CLAUDE.md, 2026-08-11). See BACKEND-ASKS.md §9.
 *
 * The cheapest feature in the AI service and the one with the best ratio of
 * value to work: it runs on /zoning's existing occupancy, so binding a name
 * to a zone this dashboard can already draw is the whole setup. No
 * calibration, no extra model, no biometrics.
 *
 * Roles: ADMIN and MANAGER, scoped through the zone's camera, the same as
 * zones themselves.
 */

export function fetchWorkstations(signal?: AbortSignal): Promise<Workstation[]> {
  return fetchJson<Workstation[]>(
    { key: 'GET /api/workstations', path: '/api/workstations', auth: true },
    { signal },
  )
}

/** 422 when the zone does not exist - the AI service's own refusal. */
export function createWorkstation(
  body: WorkstationCreate,
  signal?: AbortSignal,
): Promise<Workstation> {
  return fetchJson<Workstation>(
    { key: 'POST /api/workstations', path: '/api/workstations', method: 'POST', auth: true },
    { signal, body },
  )
}

/** The name is the key, so it goes in the path - encoded, as zones are. */
export function deleteWorkstation(name: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    {
      key: 'DELETE /api/workstations/{name}',
      path: `/api/workstations/${encodeURIComponent(name)}`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}
