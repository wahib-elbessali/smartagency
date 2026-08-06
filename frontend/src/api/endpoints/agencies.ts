import { fetchJson } from '../client'
import type { Agency } from '../types'

/** GET /api/agencies - ADMIN sees all, MANAGER sees only its own. */
export function fetchAgencies(signal?: AbortSignal): Promise<Agency[]> {
  return fetchJson<Agency[]>(
    { key: 'GET /api/agencies', path: '/api/agencies', auth: true },
    { signal },
  )
}
