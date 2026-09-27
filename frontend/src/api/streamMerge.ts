import type {
  AlertDetection,
  AlertFrame,
  OccupancyFrame,
  StoredAlert,
  PeopleFrame,
  PeopleStatus,
  PersonTrack,
  WorkstationFrame,
  WorkstationState,
  WorkstationStatus,
  ZoneOccupancy,
} from './types'

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
  /* A stored alert's state change says nothing about what a camera sees. */
  if (frame.type === 'alert_state') return current
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
  /* The whole occupancy, readiness included - dropping
     `people_tracking_ready` here would turn "not tracking yet" into a
     confident zero on screen. */
  const { type: _type, zone, ...occupancy } = frame
  return { ...current, [zone]: occupancy }
}

export type WorkstationsByName = Record<string, WorkstationState>

/**
 * Same replace-not-merge rule as the two above, with one difference that
 * comes from the feed rather than from taste: an update frame IS a
 * workstation row, not a payload wrapped in one, so the discriminant is
 * stripped off rather than reached through.
 *
 * A snapshot replaces everything, including workstations that have been
 * deleted since - which is what makes an unbind on another screen show up
 * here on reconnect rather than leaving a ghost counter on the wall.
 */
export function applyWorkstationFrame(
  current: WorkstationsByName,
  frame: WorkstationFrame,
): WorkstationsByName {
  if (frame.type === 'snapshot') {
    return Object.fromEntries(frame.workstations.map((station) => [station.name, station]))
  }
  const { type: _type, ...station } = frame
  return { ...current, [station.name]: station }
}

/**
 * The counters nobody is at - what this screen exists to surface.
 *
 * `unknown` is deliberately NOT counted as unstaffed. It means the zone has
 * not been classified yet, and padding the number that a manager acts on
 * with "we do not know" is how a screen stops being believed.
 */
export function unstaffed<T extends { name: string; status: WorkstationStatus }>(
  stations: Record<string, T>,
): T[] {
  return Object.values(stations)
    .filter((station) => station.status === 'away')
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Drops detections below a minimum confidence, keeping cameras that end up
 * empty (an empty list still means "watched and clear").
 *
 * `>=`, not `>`: the backend's own filter (ai_alerts/classifier.py) keeps a
 * detection exactly at the threshold, and the screen must agree with which
 * detections become alerts.
 */
export function atOrAbove(alerts: AlertsByCamera, minimum: number): AlertsByCamera {
  const kept: AlertsByCamera = {}
  for (const [camera, detections] of Object.entries(alerts)) {
    kept[camera] = detections.filter((d) => d.confidence >= minimum)
  }
  return kept
}

export type StoredAlertsById = Record<string, StoredAlert>

/**
 * Keeps the latest state the socket pushed for each stored alert, by id.
 *
 * Each `alert_state` frame carries the whole record, so the newest one simply
 * replaces the last - no fields to merge.
 */
export function applyAlertState(current: StoredAlertsById, frame: AlertFrame): StoredAlertsById {
  if (frame.type !== 'alert_state') return current
  const alert: StoredAlert = {
    id: frame.id,
    agency_id: frame.agency_id,
    camera_id: frame.camera_id,
    camera_name: frame.camera_name,
    alert_type: frame.alert_type,
    severity: frame.severity,
    status: frame.status,
    created_at: frame.created_at,
    resolved_at: frame.resolved_at,
  }
  return { ...current, [alert.id]: alert }
}

/**
 * The stored list as fetched, with what the socket has pushed since laid
 * over it, for one agency and one alert type, newest first.
 *
 * When both sides know an alert, the resolved copy wins. A resolution is
 * final, and either side can be the newer one: the socket after the fetch, or
 * a refetch after a socket that dropped the resolve event while reconnecting.
 * Otherwise the pushed copy wins, since it was sent after the commit.
 */
export function mergeStoredAlerts(
  fetched: readonly StoredAlert[],
  pushed: StoredAlertsById,
  agencyId: string,
  alertType: string,
): StoredAlert[] {
  const byId = new Map(fetched.map((alert) => [alert.id, alert]))
  for (const alert of Object.values(pushed)) {
    const known = byId.get(alert.id)
    if (known?.status === 'RESOLVED' && alert.status !== 'RESOLVED') continue
    byId.set(alert.id, alert)
  }
  return [...byId.values()]
    .filter((alert) => alert.agency_id === agencyId && alert.alert_type === alertType)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
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
  /* A zone that is not tracking yet has no count to add, only a 0 that
     means nothing - see ZoneOccupancy.people_tracking_ready. */
  return Object.values(zones)
    .filter((zone) => zone.people_tracking_ready)
    .reduce((sum, zone) => sum + zone.count, 0)
}

/** What the person-tracking socket has said so far. */
export interface PeopleState {
  /** Null until the socket has said anything - the REST status fills in. */
  status: Omit<PeopleStatus, 'active_tracks'> | null
  phase: PeopleStatus['phase'] | null
  tracks: PersonTrack[]
}

export const EMPTY_PEOPLE: PeopleState = { status: null, phase: null, tracks: [] }

/**
 * Folds person-tracking frames. `tracks` frames are the FULL set every cycle,
 * so they replace rather than merge - a person who left is simply absent
 * from the next one. A phase that is not `running` has no tracks: a tracker
 * that dropped back to bootstrapping must not leave its last dots frozen on
 * the map as if people were standing still.
 */
export function applyPeopleFrame(current: PeopleState, frame: PeopleFrame): PeopleState {
  if (frame.type === 'snapshot') {
    return {
      ...current,
      phase: frame.state,
      tracks: frame.state === 'running' ? frame.tracks : [],
    }
  }
  if (frame.type === 'state') {
    const { type: _type, ...status } = frame
    return {
      status,
      phase: status.phase,
      tracks: status.phase === 'running' ? current.tracks : [],
    }
  }
  return { ...current, phase: current.phase ?? 'running', tracks: frame.tracks }
}
