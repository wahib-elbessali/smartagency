import { fetchJson } from '../client'
import type { PeopleStatus } from '../types'

/**
 * Person-tracking status - GET /api/agencies/{agency_id}/ai/people/status,
 * backend/app/api/ai_people.py (PR #109). Not in contracts/api.md yet.
 * ADMIN, MANAGER and SECURITY. The gateway cuts the camera lists in the
 * answer down to the agency's own cameras; the phase is the site's.
 *
 * The tracks themselves are a socket - createPeopleStream in streams.ts.
 * Registering cameras for tracking is not here: the backend syncs every
 * camera row to the tracker itself (app/services/ai_camera_sync.py).
 */
export function fetchPeopleStatus(agencyId: string, signal?: AbortSignal): Promise<PeopleStatus> {
  return fetchJson<PeopleStatus>(
    {
      key: 'GET /api/agencies/{id}/ai/people/status',
      path: `/api/agencies/${agencyId}/ai/people/status`,
      auth: true,
    },
    { signal },
  )
}
