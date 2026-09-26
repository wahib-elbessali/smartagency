import type { CameraZoneCreate, CameraZoneEntry, CameraZoneSaved } from '@/api/types'
import { ApiError } from '@/api/errors'

/**
 * A writable stand-in for the AI service's zone store, for mock mode.
 *
 * Kept in the AI service's own shape - one flat, name-keyed map for the
 * whole site, cameras referred to by NAME - because that is what the backend
 * gateway hands back untouched (backend/app/api/ai_zoning.py). The gateway's
 * own checks (agency scope, camera names, stream URLs) live in
 * fixtures/zones.ts; this file is only the store behind them.
 *
 * THE SEEDED NAMES ARE THE OCCUPANCY STREAM'S NAMES, on purpose: lobby,
 * counters, hall and vault are exactly the zones mocks/aiStreams.ts pushes
 * counts for, and the cameras are cameraStore's names. In fixture mode the
 * Occupancy screen and the Zones screen should describe the same site, the
 * way the AI service's single store does for real.
 *
 * Refusals mirror contracts/ai-service.md §/zoning:
 *   422  fewer than 3 points
 *   404  deleting a zone that does not exist
 *   NO 409 on a duplicate name - re-posting a name REPLACES that zone, mode
 *        included. Reproduced rather than softened, because a screen built
 *        against a 409 that never comes is built against nothing.
 */

let zones: Record<string, CameraZoneEntry> | null = null

function seed(): Record<string, CameraZoneEntry> {
  if (zones === null) {
    zones = {
      lobby: {
        mode: 'pixel',
        camera: 'cam-lobby',
        polygon_px: [
          [240, 620],
          [1180, 590],
          [1320, 980],
          [180, 1010],
        ],
      },
      counters: {
        mode: 'pixel',
        camera: 'cam-counter',
        polygon_px: [
          [700, 420],
          [1500, 440],
          [1480, 820],
          [660, 800],
        ],
      },
      /* A world zone, as the AI service's own tools would make one: floor
         centimetres, drawn on cam-lobby. Its occupancy arrives as "not
         tracking yet" (aiStreams.ts), since fixture mode never runs person
         tracking. The dashboard cannot create one of these itself. */
      hall: {
        mode: 'world',
        polygon_m: [
          [0, 0],
          [640, 0],
          [640, 420],
          [0, 420],
        ],
        converted_from: {
          camera: 'cam-lobby',
          polygon_px: [
            [160, 560],
            [1500, 540],
            [1640, 1040],
            [80, 1060],
          ],
        },
      },
      /* On the Rabat camera, so a Casablanca manager's screen filters it out
         - the gateway itself returns it to everyone. Also the only OFFLINE
         camera, which makes it the zone that exists on a camera with no
         picture to redraw it over: a zone outlives its stream. */
      vault: {
        mode: 'pixel',
        camera: 'cam-store',
        polygon_px: [
          [520, 300],
          [1400, 330],
          [1380, 900],
          [500, 870],
        ],
      },
    }
  }
  return zones
}

function clonePoints(points: Array<[number, number]> | undefined) {
  return points?.map(([x, y]) => [x, y] as [number, number])
}

/** GET /zoning/zones: the whole site's map, `{}` when there are none. */
export function listZones(): Record<string, CameraZoneEntry> {
  return Object.fromEntries(
    Object.entries(seed()).map(([name, entry]) => [
      name,
      {
        ...entry,
        polygon_px: clonePoints(entry.polygon_px),
        polygon_m: clonePoints(entry.polygon_m),
      },
    ]),
  )
}

/**
 * POST /zoning/zones, pixel mode only: fixture mode has no calibrated
 * cameras, so a multi-camera (world) zone is refused upstream in
 * fixtures/zones.ts exactly as the gateway refuses one while person
 * tracking is not running.
 */
export function createZone(body: CameraZoneCreate): CameraZoneSaved {
  if (!Array.isArray(body.polygon) || body.polygon.length < 3) {
    throw new ApiError('http', 'Une zone demande au moins 3 points', 422)
  }

  seed()[body.name] = {
    mode: 'pixel',
    camera: body.camera,
    polygon_px: body.polygon.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
  }

  /* Empty warnings, and that is not a placeholder: the AI service's
     documented warnings are about world zones with /people not running,
     which cannot apply to a pixel zone. */
  return {
    name: body.name,
    mode: 'pixel',
    saved: 'ai/features/data/zones.json',
    sources_known: Object.keys(body.sources).sort(),
    warnings: [],
  }
}

export function deleteZone(name: string): void {
  const store = seed()
  if (!(name in store)) throw new ApiError('http', 'Zone introuvable', 404)
  delete store[name]
}

/** Tests only - module state would otherwise leak between them. */
export function resetZoneStore(): void {
  zones = null
}
