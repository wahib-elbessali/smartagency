import { registerMock, registerMockWriter } from '../registry'
import type { CameraZoneCreate, CameraZoneEntry } from '@/api/types'
import { ApiError } from '@/api/errors'
import { agencyIdFromPath, camerasByName, ensureAgencyScope, nameFromPath } from '../aiGateway'
import * as store from '../zoneStore'

/**
 * GET/POST /api/agencies/{id}/ai/zones and DELETE .../ai/zones/{name} -
 * backend/app/api/ai_zoning.py, reproduced check for check.
 *
 * The read returns the WHOLE site's map to anyone allowed to read the
 * agency, because that is what the gateway does: it checks scope and then
 * passes the AI service's store through unfiltered. Narrowing it to the
 * agency's cameras is the screen's job, and reproducing the gateway exactly
 * is what lets a test catch a screen that forgets.
 */

function visibleZones(path: string): Record<string, CameraZoneEntry> {
  ensureAgencyScope(agencyIdFromPath(path))
  return store.listZones()
}

registerMock<Record<string, CameraZoneEntry>>('GET /api/agencies/{id}/ai/zones', {
  normal: visibleZones,
  empty: (path) => {
    ensureAgencyScope(agencyIdFromPath(path))
    return {}
  },
  large: visibleZones,
})

registerMockWriter('POST /api/agencies/{id}/ai/zones', (body, path) => {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  const payload = body as CameraZoneCreate

  const name = payload.name.trim()
  const camera = payload.camera.trim()
  const sourceNames = Object.keys(payload.sources ?? {})
  if (!sourceNames.includes(camera)) {
    throw new ApiError('http', 'La camera de dessin doit apparaitre dans sources', 422)
  }
  const cameras = camerasByName(agencyId, sourceNames, true)
  for (const [sourceName, url] of Object.entries(payload.sources)) {
    if (!url.trim()) throw new ApiError('http', `Flux vide pour la camera ${sourceName}`, 422)
  }
  /* A world zone needs /people running. Fixture mode never has it running,
     so this is the refusal the gateway gives in that state. */
  if (sourceNames.length > 1) {
    throw new ApiError(
      'http',
      'Le person tracking doit etre en etat running avant de creer une zone mondiale (etat actuel: idle)',
      422,
    )
  }

  /* The gateway swaps the submitted URLs for the ones in our database. */
  const sources = Object.fromEntries(
    [...cameras.values()].map((row) => [row.name, row.stream_url ?? '']),
  )
  return store.createZone({ ...payload, name, camera, sources })
})

registerMockWriter('DELETE /api/agencies/{id}/ai/zones/{name}', (_body, path) => {
  ensureAgencyScope(agencyIdFromPath(path))
  store.deleteZone(nameFromPath(path))
  return undefined
})
