import type { PeoplePhase, PeopleRoom, PeopleStatus, PersonTrack } from '@/api/types'

/**
 * Person tracking for mock mode - a SCRIPTED REPLAY, like the occupancy feed
 * in aiStreams.ts, not a model of the site's cameras.
 *
 * The real tracker starts only once every registered camera on the site is
 * calibrated and aligned, and the backend registers every camera of every
 * branch - so against today's backend it cannot start at all with two
 * branches (raised with backend). Reproducing that here would leave the map
 * and world-zone screens permanently empty in fixture mode, with nothing to
 * build or check against. So this plays the tracker's own life on a clock
 * instead: `idle`, then `bootstrapping`, then `running` with a few people
 * walking a room - the phases in order, as the real one goes through them.
 *
 * REST status and the socket read the same clock, so the badge, the counts
 * and the dots never disagree.
 */

const UNDER_TEST = import.meta.env.MODE === 'test'
/* Wall-clock phases; compressed under test so a suite does not wait 5 s. */
const IDLE_MS = UNDER_TEST ? 20 : 1_500
const BOOT_MS = UNDER_TEST ? 40 : 4_000
/** How often a running tracker pushes a full set of tracks. */
export const PEOPLE_CYCLE_MS = UNDER_TEST ? 20 : 1_000

export const MOCK_ROOM: PeopleRoom = { xmin: 0, xmax: 800, ymin: 0, ymax: 600 }

let startedAt: number | null = null

function elapsed(now: number): number {
  if (startedAt === null) startedAt = now
  return now - startedAt
}

export function peoplePhase(now = Date.now()): PeoplePhase {
  const t = elapsed(now)
  if (t < IDLE_MS) return 'idle'
  if (t < IDLE_MS + BOOT_MS) return 'bootstrapping'
  return 'running'
}

/**
 * Three people: one crossing the room, one circling near the counters, and
 * one who leaves and comes back - under a NEW id, as the real tracker gives a
 * returning person, since it cannot know it is the same one.
 */
export function peopleTracks(now = Date.now()): PersonTrack[] {
  if (peoplePhase(now) !== 'running') return []
  const t = (elapsed(now) - IDLE_MS - BOOT_MS) / 1000
  const tracks: PersonTrack[] = [
    {
      id: 1,
      x: 80 + ((t * 40) % 640),
      y: 300 + 60 * Math.sin(t / 3),
      hits: Math.floor(t) + 5,
      misses: 0,
    },
    {
      id: 2,
      x: 560 + 90 * Math.cos(t / 2),
      y: 180 + 90 * Math.sin(t / 2),
      hits: Math.floor(t) + 12,
      misses: 0,
    },
  ]
  /* Present for 12 s, gone for 6, back under the next id. */
  const cycle = Math.floor(t / 18)
  if (t % 18 < 12) {
    tracks.push({
      id: 3 + cycle,
      x: 200 + 10 * (t % 18),
      y: 480,
      hits: Math.floor(t % 18) + 1,
      misses: 0,
    })
  }
  return tracks.map((track) => ({
    ...track,
    x: Math.round(track.x * 100) / 100,
    y: Math.round(track.y * 100) / 100,
  }))
}

export function peopleStatus(now = Date.now()): PeopleStatus {
  const phase = peoplePhase(now)
  const running = phase === 'running'
  return {
    phase,
    warnings: [],
    error: null,
    person_scale: running ? 33.1 : null,
    room: running ? { ...MOCK_ROOM } : null,
    fps: running ? 25 : null,
    cams_bootstrapped: running ? ['cam-counter', 'cam-lobby'] : null,
    gates_loaded: running ? 0 : null,
    active_tracks: running ? peopleTracks(now).length : null,
  }
}

/** Tests only - starts the replay again from `idle`. */
export function resetPeopleStore(): void {
  startedAt = null
}

/** Tests only - jumps straight to a running tracker. */
export function startPeopleRunning(now = Date.now()): void {
  startedAt = now - IDLE_MS - BOOT_MS
}
