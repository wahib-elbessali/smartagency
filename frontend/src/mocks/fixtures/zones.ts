import { registerMock, registerMockWriter } from '../registry'
import type { CameraZoneCreate, CameraZoneEntry } from '@/api/types'
import { ApiError } from '@/api/errors'
import { agencyIdFromPath, camerasByName, ensureAgencyScope, nameFromPath } from '../aiGateway'
import * as store from '../zoneStore'
import { worldMatrixOf } from '../calibrationStore'
import { peoplePhase } from '../peopleStore'

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
  /* A world zone: the gateway first wants person tracking running
     (_ensure_world_tracking_ready), then the AI service wants the drawn-on
     camera calibrated and aligned. */
  let worldMatrix: ReturnType<typeof worldMatrixOf> | undefined
  if (sourceNames.length > 1) {
    const phase = peoplePhase()
    if (phase !== 'running') {
      throw new ApiError(
        'http',
        `Le person tracking doit etre en etat running avant de creer une zone mondiale (etat actuel: ${phase})`,
        422,
      )
    }
    worldMatrix = worldMatrixOf(camera)
    if (typeof worldMatrix === 'string') throw new ApiError('http', worldMatrix, 422)
  }

  /* The gateway swaps the submitted URLs for the ones in our database. */
  const sources = Object.fromEntries(
    [...cameras.values()].map((row) => [row.name, row.stream_url ?? '']),
  )
  return store.createZone(
    { ...payload, name, camera, sources },
    typeof worldMatrix === 'object' ? worldMatrix : undefined,
  )
})

registerMockWriter('DELETE /api/agencies/{id}/ai/zones/{name}', (_body, path) => {
  ensureAgencyScope(agencyIdFromPath(path))
  store.deleteZone(nameFromPath(path))
  return undefined
})
