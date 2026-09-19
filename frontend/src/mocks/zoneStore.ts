import type { CameraZone, CameraZoneCreate, CameraZoneSaved } from '@/api/types'
import { ApiError } from '@/api/errors'
import { CAMERA_ID_COUNTER, CAMERA_ID_LOBBY, CAMERA_ID_STORE } from './cameraStore'

/**
 * A writable set of detection zones for mock mode.
 *
 * THE SEEDED NAMES ARE THE OCCUPANCY STREAM'S NAMES, on purpose: lobby,
 * counters and vault are exactly the three zones mocks/aiStreams.ts pushes
 * counts for. In fixture mode the Occupancy screen and this screen should
 * describe the same site, the way the AI service's single zone store does
 * for real - draw a zone here and the occupancy feed has no idea (it is a
 * scripted replay), but at least the two lists are not describing different
 * buildings. Same reasoning as cameraStore seeding the alert stream's camera
 * names.
 *
 * Refusals mirror contracts/ai-service.md §/zoning:
 *   422  fewer than 3 points, or a blank name
 *   404  deleting a zone that does not exist
 *   NO 409 on a duplicate name - re-posting a name REPLACES that zone, mode
 *        included. That is the AI service's documented behaviour and it is
 *        reproduced rather than softened, because a screen built against a
 *        409 that never comes would be a screen built against nothing.
 */

let zones: CameraZone[] | null = null

function seed(): CameraZone[] {
  if (zones === null) {
    zones = [
      {
        name: 'lobby',
        mode: 'pixel',
        camera_id: CAMERA_ID_LOBBY,
        polygon_px: [
          [240, 620],
          [1180, 590],
          [1320, 980],
          [180, 1010],
        ],
        polygon_m: null,
      },
      {
        name: 'counters',
        mode: 'pixel',
        camera_id: CAMERA_ID_COUNTER,
        polygon_px: [
          [700, 420],
          [1500, 440],
          [1480, 820],
          [660, 800],
        ],
        polygon_m: null,
      },
      /* On the Rabat camera, so a Casablanca manager never sees it and an
         admin switching branches does. Also the only OFFLINE camera, which
         makes it the zone that exists on a camera with no picture to
         redraw it over - a real state, since a zone outlives the stream. */
      {
        name: 'vault',
        mode: 'pixel',
        camera_id: CAMERA_ID_STORE,
        polygon_px: [
          [520, 300],
          [1400, 330],
          [1380, 900],
          [500, 870],
        ],
        polygon_m: null,
      },
    ]
  }
  return zones
}

function clone(zone: CameraZone): CameraZone {
  return {
    ...zone,
    polygon_px: zone.polygon_px
      ? zone.polygon_px.map(([x, y]) => [x, y] as [number, number])
      : null,
    polygon_m: zone.polygon_m ? zone.polygon_m.map(([x, y]) => [x, y] as [number, number]) : null,
  }
}

export function listZones(): CameraZone[] {
  return seed().map(clone)
}

export function createZone(body: CameraZoneCreate): CameraZoneSaved {
  const name = body.name.trim()
  if (!name) throw new ApiError('http', 'Le nom de la zone est obligatoire', 422)
  if (!Array.isArray(body.polygon) || body.polygon.length < 3) {
    throw new ApiError('http', 'Une zone demande au moins 3 points', 422)
  }

  const saved: CameraZone = {
    name,
    /* One camera in `sources` - the AI service infers pixel mode from that,
       and this screen sends exactly one. */
    mode: 'pixel',
    camera_id: body.camera_id,
    polygon_px: body.polygon.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
    polygon_m: null,
  }

  const list = seed()
  const existing = list.findIndex((zone) => zone.name === name)
  if (existing === -1) list.push(saved)
  else list[existing] = saved

  /* Empty, and that is not a placeholder. The AI service's documented
     warnings are about world zones with /people not running, and about
     cameras assigned to people/zoning with no calibration - neither can
     apply to a pixel zone, which needs no calibration and reads that one
     camera's own detections. */
  return { ...clone(saved), warnings: [] }
}

export function deleteZone(name: string): void {
  const list = seed()
  const index = list.findIndex((zone) => zone.name === name)
  if (index === -1) throw new ApiError('http', 'Zone introuvable', 404)
  list.splice(index, 1)
}

/** Tests only - module state would otherwise leak between them. */
export function resetZoneStore(): void {
  zones = null
}
