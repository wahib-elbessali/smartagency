import type { Workstation, WorkstationCreate, WorkstationState } from '@/api/types'
import { ApiError } from '@/api/errors'
import { listEmployees } from './employeeStore'
import { AGENCY_ID, AGENCY_ID_RABAT } from './fixtures/people'
import { listZones } from './zoneStore'

/**
 * A writable stand-in for the backend's `workstations` table plus the AI
 * service's state for each row, for mock mode.
 *
 * Refusals are backend/app/api/employee_activity.py's, in its order and with
 * its French details (agency scope is checked by the fixture, via
 * aiGateway.ts):
 *   422  a blank name or zone
 *   404  an unknown employee; 422 one from another agency
 *   422  a zone the AI service does not have
 *   409  a name another agency already uses - names are unique site-wide
 *   404  deleting a workstation this agency does not have
 *   Re-posting a name this agency has REBINDS it, zone and employee both.
 *
 * The seeded three are the ones the mock status stream speaks about
 * (aiStreams.ts), bound to zones zoneStore seeds - the same chain the real
 * thing has: a camera carries a zone, a zone carries a workstation.
 */

interface Row extends WorkstationState {
  agency_id: string
  employee_id: string | null
}

let rows: Row[] | null = null

/* Fixed offsets from "now" at seed time, so a status that has been held for
   forty minutes still reads as forty minutes whenever the suite runs. */
function seed(): Row[] {
  if (rows === null) {
    const now = Date.now() / 1000
    const casablanca = listEmployees().find((employee) => employee.agency_id === AGENCY_ID)
    rows = [
      /* Genuinely empty, and long enough that it is past the service's
         absence window - the state the screen exists to surface. Matches the
         mock stream's opening snapshot, so the two agree on connect. */
      {
        agency_id: AGENCY_ID,
        employee_id: null,
        name: 'accueil',
        zone: 'lobby',
        status: 'away',
        since: now - 720,
        zone_known: true,
      },
      {
        agency_id: AGENCY_ID,
        employee_id: casablanca?.id ?? null,
        name: 'guichet-3',
        zone: 'counters',
        status: 'present',
        since: now - 2_400,
        zone_known: true,
      },
      /* Rabat, on a zone whose camera has never produced a frame. */
      {
        agency_id: AGENCY_ID_RABAT,
        employee_id: null,
        name: 'coffre',
        zone: 'vault',
        status: 'unknown',
        since: now - 7_200,
        zone_known: false,
      },
    ]
  }
  return rows
}

function toResponse(row: Row): Workstation {
  const employee = listEmployees().find((candidate) => candidate.id === row.employee_id)
  return {
    name: row.name,
    zone: row.zone,
    employee_id: row.employee_id,
    employee_name: employee ? `${employee.first_name} ${employee.last_name}` : null,
    status: row.status,
    since: row.since,
    zone_known: row.zone_known,
  }
}

/** GET: this agency's rows, by name, as backend orders them. */
export function listWorkstations(agencyId: string): Workstation[] {
  return seed()
    .filter((row) => row.agency_id === agencyId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toResponse)
}

export function createWorkstation(agencyId: string, body: WorkstationCreate): Workstation {
  const name = body.name.trim()
  const zone = body.zone.trim()
  if (!name || !zone) throw new ApiError('http', 'Le nom et la zone sont obligatoires', 422)

  const employeeId = body.employee_id ?? null
  if (employeeId !== null) {
    const employee = listEmployees().find((candidate) => candidate.id === employeeId)
    if (!employee) throw new ApiError('http', 'Employe introuvable', 404)
    if (employee.agency_id !== agencyId) {
      throw new ApiError('http', "L'employe doit appartenir a la meme agence", 422)
    }
  }

  if (!(zone in listZones())) {
    throw new ApiError(
      'http',
      `La zone AI '${zone}' est introuvable. Creez-la d'abord avec POST /api/agencies/{agency_id}/ai/zones`,
      422,
    )
  }

  const list = seed()
  const existing = list.find((row) => row.name === name)
  if (existing && existing.agency_id !== agencyId) {
    throw new ApiError('http', 'Ce poste de travail existe dans une autre agence', 409)
  }

  /* Not `away`: nothing has been measured for this binding yet, and the
     difference between "no reading" and "empty" is the whole reason
     `zone_known` exists. The service classifies it on its next poll. */
  const row: Row = {
    agency_id: agencyId,
    employee_id: employeeId,
    name,
    zone,
    status: 'unknown',
    since: Date.now() / 1000,
    zone_known: false,
  }
  if (existing) Object.assign(existing, row)
  else list.push(row)
  return toResponse(row)
}

export function deleteWorkstation(agencyId: string, name: string): void {
  const list = seed()
  const index = list.findIndex((row) => row.agency_id === agencyId && row.name === name)
  if (index === -1) throw new ApiError('http', 'Poste de travail introuvable', 404)
  list.splice(index, 1)
}

/** Tests only - module state would otherwise leak between them. */
export function resetWorkstationStore(): void {
  rows = null
}
