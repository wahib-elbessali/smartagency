import { registerMock } from '../registry'
import type { PeopleStatus } from '@/api/types'
import { agencyIdFromPath, ensureAgencyScope } from '../aiGateway'
import { listCameras } from '../cameraStore'
import * as store from '../peopleStore'

/**
 * GET /api/agencies/{id}/ai/people/status - backend/app/api/ai_people.py:
 * agency scope, then the AI service's status with its camera lists cut to
 * the agency's own camera names. The phase is the scripted replay in
 * peopleStore.ts - see there for why it is a replay.
 */
function status(path: string): PeopleStatus {
  const agencyId = agencyIdFromPath(path)
  ensureAgencyScope(agencyId)
  const names = new Set(listCameras(agencyId).map((camera) => camera.name))
  const answer = store.peopleStatus()
  return {
    ...answer,
    cams_bootstrapped: answer.cams_bootstrapped?.filter((name) => names.has(name)) ?? null,
  }
}

registerMock<PeopleStatus>('GET /api/agencies/{id}/ai/people/status', {
  normal: status,
  empty: status,
  large: status,
})
