import { registerMock, registerMockWriter } from '../registry'
import type { WantedPerson, WantedThreshold, WantedThresholdUpdate } from '@/api/types'
import { ApiError } from '@/api/errors'
import { listAgencies } from '../agencyStore'
import { requestUser } from '../currentUser'
import * as store from '../wantedStore'

/**
 * /api/ai/watchlist and its threshold - backend/app/api/wanted.py, with its
 * scoping: a MANAGER reads and removes only their agency's entries, an ADMIN
 * all of them; adding resolves the owning agency the way _agency_for_write
 * does. Roles are in mocks/roles.ts.
 */

/** null means "every agency" - an ADMIN, or no session in a test. */
function scope(): string | null {
  const user = requestUser()
  if (!user || user.role === 'ADMIN') return null
  return user.agency_id
}

/** _agency_for_write. */
function owningAgency(requested: string | null): string {
  const user = requestUser()
  if (!user || user.role === 'ADMIN') {
    if (requested) return requested
    const agencies = listAgencies()
    if (agencies.length !== 1) {
      throw new ApiError('http', 'agency_id est obligatoire pour un ADMIN multi-agences', 422)
    }
    return agencies[0].id
  }
  if (!user.agency_id) throw new ApiError('http', 'Utilisateur sans agence', 403)
  if (requested && requested !== user.agency_id) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
  return user.agency_id
}

registerMock<WantedPerson[]>('GET /api/ai/watchlist', {
  normal: () => store.listWatchlist(scope()),
  empty: () => [],
  large: () => store.listWatchlist(scope()),
})

registerMockWriter('POST /api/ai/watchlist', (body) => {
  const form = body as FormData
  const agencyId = owningAgency((form.get('agency_id') as string | null) ?? null)
  return store.addToWatchlist(
    agencyId,
    String(form.get('name') ?? ''),
    form.get('image') instanceof File ? (form.get('image') as File) : null,
  )
})

registerMockWriter('DELETE /api/ai/watchlist/{name}', (_body, path) => {
  const name = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
  return store.removeFromWatchlist(name, scope())
})

registerMock<WantedThreshold>('GET /api/ai/watchlist/threshold', {
  normal: store.getThreshold,
  empty: store.getThreshold,
  large: store.getThreshold,
})

registerMockWriter('PUT /api/ai/watchlist/threshold', (body) =>
  store.setThreshold(body as WantedThresholdUpdate),
)
