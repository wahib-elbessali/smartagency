import { fetchJson } from '../client'
import type { StoredAlert } from '../types'

/**
 * Stored business alerts - contracts/api.md §14, added in #112.
 *
 * ADMIN reads any agency; MANAGER and SECURITY only their own (403
 * otherwise). Newest first. `alertType` filters server-side, e.g. 'weapon'.
 *
 * There is no limit or paging: the backend returns every alert the agency
 * has ever had of that type.
 */
export function fetchStoredAlerts(
  agencyId: string,
  alertType?: string,
  signal?: AbortSignal,
): Promise<StoredAlert[]> {
  const query = alertType ? `?alert_type=${encodeURIComponent(alertType)}` : ''
  return fetchJson<StoredAlert[]>(
    {
      key: 'GET /api/agencies/{id}/alerts',
      path: `/api/agencies/${agencyId}/alerts${query}`,
      auth: true,
    },
    { signal },
  )
}
