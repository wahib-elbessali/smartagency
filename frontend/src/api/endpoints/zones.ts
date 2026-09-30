import { fetchJson } from '../client'
import type { CameraZone, CameraZoneCreate, CameraZoneEntry, CameraZoneSaved } from '../types'

/**
 * Detection zones - backend/app/api/ai_zoning.py (PR #109, 2026-09-23), the
 * authenticated gateway in front of the AI service's /zoning routes
 * (contracts/ai-service.md §/zoning). Not in contracts/api.md yet, so the
 * paths and bodies here are transcribed from that backend source; whoever
 * owns it should add the entries.
 *
 * These are the polygons the AI service counts people inside. They are NOT
 * `Agency.zones`; see the comment on `CameraZone` in api/types.ts.
 *
 * Roles (from the gateway): reading is ADMIN, MANAGER and SECURITY; creating
 * and deleting are ADMIN and MANAGER. Everything is under the agency's path
 * and a MANAGER is refused another agency with a 403.
 */

/**
 * The name-keyed map the gateway answers, folded into a list with each name
 * inside its entry - the one place that fold happens.
 *
 * For a `world` zone the drawn-on camera and its pixel outline live under
 * `converted_from` rather than at the top level; reading them from there is
 * what lets a world zone still be redrawn on the camera it came from.
 */
export function zonesFromMap(map: Record<string, CameraZoneEntry>): CameraZone[] {
  return Object.entries(map).map(([name, entry]) => ({
    name,
    mode: entry.mode,
    camera: entry.camera ?? entry.converted_from?.camera ?? null,
    polygon_px: entry.polygon_px ?? entry.converted_from?.polygon_px ?? null,
    polygon_m: entry.polygon_m ?? null,
  }))
}

/**
 * Every zone ON THE WHOLE SITE. The gateway checks the caller may read this
 * agency and then returns the AI service's entire store unfiltered, so a
 * caller narrows it to the agency's own camera names - see
 * `zonesOnCameras` below.
 */
export async function fetchZones(agencyId: string, signal?: AbortSignal): Promise<CameraZone[]> {
  const map = await fetchJson<Record<string, CameraZoneEntry>>(
    {
      key: 'GET /api/agencies/{id}/ai/zones',
      path: `/api/agencies/${agencyId}/ai/zones`,
      auth: true,
    },
    { signal },
  )
  return zonesFromMap(map)
}

/** The zones drawn on one of these cameras, by camera name. */
export function zonesOnCameras(
  zones: CameraZone[],
  cameras: ReadonlyArray<{ name: string }>,
): CameraZone[] {
  const names = new Set(cameras.map((camera) => camera.name))
  return zones.filter((zone) => zone.camera !== null && names.has(zone.camera))
}

/** Creating a zone whose name already exists REPLACES it - no 409. */
export function createZone(
  agencyId: string,
  body: CameraZoneCreate,
  signal?: AbortSignal,
): Promise<CameraZoneSaved> {
  return fetchJson<CameraZoneSaved>(
    {
      key: 'POST /api/agencies/{id}/ai/zones',
      path: `/api/agencies/${agencyId}/ai/zones`,
      method: 'POST',
      auth: true,
    },
    { signal, body },
  )
}

/**
 * The name is the key, so it goes in the path - encoded, since nothing stops
 * someone naming a zone "hall d'entrée" or "counter/2". 204 on success; 404
 * from the AI service when the name does not exist.
 */
export function deleteZone(agencyId: string, name: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    {
      key: 'DELETE /api/agencies/{id}/ai/zones/{name}',
      path: `/api/agencies/${agencyId}/ai/zones/${encodeURIComponent(name)}`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}
