import { registerMock, registerMockWriter } from '../registry'
import type { Workstation, WorkstationCreate } from '@/api/types'
import { ApiError } from '@/api/errors'
import * as cameras from '../cameraStore'
import * as store from '../workstationStore'
import { listZones } from '../zoneStore'
import { requestUser } from '../currentUser'

/**
 * PROPOSED - GET/POST /api/workstations and DELETE /api/workstations/{name},
 * see api/endpoints/workstations.ts. Field names from
 * contracts/ai-service.md §/employee_activity.
 *
 * SCOPING RUNS DOWN THE CHAIN, one link longer than the zones fixture's.
 *
 * A workstation names a zone, a zone names a camera, and the camera is the
 * only thing that knows which branch any of this belongs to - the AI service
 * has no notion of an agency at all. So a MANAGER sees the workstations whose
 * zone sits on one of their own cameras, and a write against another branch's
 * zone is the 403 cameras.py already answers.
 *
 * A workstation bound to a zone that no longer exists is kept rather than
 * hidden: deleting the zone out from under it is exactly the misconfiguration
 * worth seeing, and only an ADMIN can see across every branch anyway. The
 * screen renders it with the zone named, so it is fixable.
 */

function agencyOfZone(zoneName: string): string | null {
  const zone = listZones().find((candidate) => candidate.name === zoneName)
  if (!zone || zone.camera_id === null) return null
  try {
    return cameras.getCamera(zone.camera_id).agency_id
  } catch {
    return null
  }
}

function ensureZoneScope(zoneName: string): void {
  const user = requestUser()
  if (!user || user.role === 'ADMIN') return
  const agencyId = agencyOfZone(zoneName)
  /* An unattachable zone belongs to no branch, so nobody but an ADMIN may
     write against it - the same call the zones fixture makes. */
  if (agencyId === null || user.agency_id !== agencyId) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
}

function visibleWorkstations(): Workstation[] {
  const user = requestUser()
  const all = store.listWorkstations()
  if (!user || user.role === 'ADMIN') return all
  return all.filter((station) => agencyOfZone(station.zone) === user.agency_id)
}

registerMock<Workstation[]>('GET /api/workstations', {
  normal: visibleWorkstations,
  empty: () => [],
  large: visibleWorkstations,
})

registerMockWriter('POST /api/workstations', (body) => {
  const payload = body as WorkstationCreate
  ensureZoneScope(payload.zone)
  return store.createWorkstation(payload)
})

registerMockWriter('DELETE /api/workstations/{name}', (_body, path) => {
  const parts = path.split('/').filter(Boolean)
  const name = decodeURIComponent(parts[parts.length - 1] ?? '')
  const station = store.listWorkstations().find((candidate) => candidate.name === name)
  if (!station) throw new ApiError('http', 'Poste introuvable', 404)
  ensureZoneScope(station.zone)
  store.deleteWorkstation(name)
  return undefined
})
