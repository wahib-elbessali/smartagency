import { registerMock, registerMockWriter } from '../registry'
import type { Workstation, WorkstationCreate } from '@/api/types'
import { agencyIdFromPath, ensureAgencyScope, nameFromPath } from '../aiGateway'
import * as store from '../workstationStore'

/**
 * GET/POST /api/agencies/{id}/workstations and DELETE .../workstations/{name}
 * - backend/app/api/employee_activity.py, reproduced check for check.
 *
 * Scoping is by the agency in the path, because the rows are ours and carry
 * an agency_id. Worth knowing what backend does NOT check: that the zone a
 * workstation is bound to is drawn on one of this agency's cameras. Any
 * zone that exists anywhere on the site is accepted, and so is it here - a
 * fixture stricter than the route would hide that from whoever builds the
 * screen.
 */

registerMock<Workstation[]>('GET /api/agencies/{id}/workstations', {
  normal: (path) => {
    const agencyId = agencyIdFromPath(path)
    ensureAgencyScope(agencyId)
    return store.listWorkstations(agencyId)
  },
  empty: (path) => {
    ensureAgencyScope(agencyIdFromPath(path))
    return []
  },
  large: (path) => {
    const agencyId = agencyIdFromPath(path)
    ensureAgencyScope(agencyId)
    return store.listWorkstations(agencyId)
  },
})

registerMockWriter('POST /api/agencies/{id}/workstations', (body, path) => {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  return store.createWorkstation(agencyId, body as WorkstationCreate)
})

registerMockWriter('DELETE /api/agencies/{id}/workstations/{name}', (_body, path) => {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  store.deleteWorkstation(agencyId, nameFromPath(path))
  return undefined
})
