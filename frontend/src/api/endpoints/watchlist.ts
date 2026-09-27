import { fetchJson } from '../client'
import type { WantedDeleted, WantedPerson, WantedThreshold, WantedThresholdUpdate } from '../types'

/**
 * The wanted watchlist - backend/app/api/wanted.py (PR #109), in front of
 * the AI service's /wanted gallery. Not in contracts/api.md yet; paths,
 * fields and statuses transcribed from that backend source.
 *
 * Reading (list and threshold) is ADMIN, MANAGER and SECURITY; adding,
 * removing and moving the threshold are ADMIN and MANAGER. A MANAGER sees and
 * edits only their own agency's entries; an ADMIN sees all of them. Every
 * call is written to the backend's audit log - photos and embeddings never
 * are.
 */

export function fetchWatchlist(signal?: AbortSignal): Promise<WantedPerson[]> {
  return fetchJson<WantedPerson[]>(
    { key: 'GET /api/ai/watchlist', path: '/api/ai/watchlist', auth: true },
    { signal },
  )
}

/**
 * Adds a person with ONE photo showing exactly one face (multipart). 409 if
 * the name is already on the list - anywhere on the site, since the AI
 * gallery is shared - so adding more photos to an existing name is not
 * possible through this gateway. 422 for a bad name or a non-image, 413 over
 * 10 MB. An ADMIN must name the agency when there is more than one; a
 * MANAGER's is their own.
 */
export function addToWatchlist(
  entry: { name: string; image: File; agencyId?: string | null },
  signal?: AbortSignal,
): Promise<WantedPerson> {
  const form = new FormData()
  form.append('name', entry.name)
  form.append('image', entry.image)
  if (entry.agencyId) form.append('agency_id', entry.agencyId)
  return fetchJson<WantedPerson>(
    { key: 'POST /api/ai/watchlist', path: '/api/ai/watchlist', method: 'POST', auth: true },
    { signal, body: form },
  )
}

/** Removes the person and every photo enrolled for them. */
export function removeFromWatchlist(name: string, signal?: AbortSignal): Promise<WantedDeleted> {
  return fetchJson<WantedDeleted>(
    {
      key: 'DELETE /api/ai/watchlist/{name}',
      path: `/api/ai/watchlist/${encodeURIComponent(name)}`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}

export function fetchWantedThreshold(signal?: AbortSignal): Promise<WantedThreshold> {
  return fetchJson<WantedThreshold>(
    {
      key: 'GET /api/ai/watchlist/threshold',
      path: '/api/ai/watchlist/threshold',
      auth: true,
    },
    { signal },
  )
}

/**
 * Moves the threshold and/or minimum face size. The screen reads the result
 * back with a GET rather than trusting this response: the AI service's PUT
 * answer lacks fields the gateway's response model requires (raised with
 * backend), so only the GET is known to be complete.
 */
export function setWantedThreshold(
  body: WantedThresholdUpdate,
  signal?: AbortSignal,
): Promise<WantedThreshold> {
  return fetchJson<WantedThreshold>(
    {
      key: 'PUT /api/ai/watchlist/threshold',
      path: '/api/ai/watchlist/threshold',
      method: 'PUT',
      auth: true,
    },
    { signal, body },
  )
}
