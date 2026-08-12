import type { AlertDetection, AlertFrame, OccupancyFrame, ZoneOccupancy } from './types'

/**
 * Folding snapshot + update frames into current state.
 *
 * Kept out of the screens and tested on its own, for the same reason
 * attendanceMerge is: this is where a live feed quietly goes wrong, and a bug
 * here shows up as a wall display that is calmly, confidently stale.
 *
 * Both feeds share a shape - a `snapshot` that replaces everything, then
 * `update` frames that replace one key - but they differ in one way that
 * matters, so they get two functions rather than one clever generic.
 */

export type AlertsByCamera = Record<string, AlertDetection[]>

/**
 * An update REPLACES that camera's detections; it does not merge into them.
 *
 * The service fires only when a camera's set of detected classes changes, and
 * sends the full current set each time. Appending instead of replacing is the
 * obvious mistake and it makes a cleared alert stay on screen forever - which
 * on a security display is worse than missing one, because it trains people to
 * ignore the panel.
 */
export function applyAlertFrame(current: AlertsByCamera, frame: AlertFrame): AlertsByCamera {
  if (frame.type === 'snapshot') {
    /* A snapshot is the whole truth, including cameras that have gone away. */
    return { ...frame.cameras }
  }
  return { ...current, [frame.camera]: frame.detections }
}

export type ZonesByName = Record<string, ZoneOccupancy>

/**
 * Same replace-not-merge rule, and one addition: a zone dropping to zero is a
 * real update, not an absence.
 *
 * `{count: 0, points: []}` has to survive into the rendered state so the row
 * shows "0" rather than keeping the last non-zero number. Filtering empty
 * zones out of the display is how a lobby that emptied ten minutes ago still
 * reads as busy.
 */
export function applyOccupancyFrame(current: ZonesByName, frame: OccupancyFrame): ZonesByName {
  if (frame.type === 'snapshot') {
    return { ...frame.zones }
  }
  return { ...current, [frame.zone]: { count: frame.count, points: frame.points } }
}

/** Cameras with at least one detection, which is what a screen leads with. */
export function activeCameras(alerts: AlertsByCamera): string[] {
  return Object.keys(alerts)
    .filter((camera) => (alerts[camera]?.length ?? 0) > 0)
    .sort()
}

/**
 * Total people seen across zones.
 *
 * Deliberately NOT presented as "people in the building": a person standing in
 * two overlapping zones is counted twice, and a boundary counts as inside. The
 * contract is explicit about both. Summing is still useful as a trend, so long
 * as nothing labels it as a headcount.
 */
export function totalAcrossZones(zones: ZonesByName): number {
  return Object.values(zones).reduce((sum, zone) => sum + zone.count, 0)
}
