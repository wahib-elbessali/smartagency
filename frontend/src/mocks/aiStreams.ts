import { MOCK_SCENARIO } from '@/api/config'
import type { SocketStream, StreamStatus } from '@/api/socketStream'
import type { AlertFeature, AlertFrame, OccupancyFrame, WorkstationFrame } from '@/api/types'

/**
 * Fake alerts and occupancy sockets for mock mode.
 *
 * Both mirror the semantics documented in contracts/ai-service.md rather than
 * inventing a convenient rhythm, because the semantics are the part most
 * likely to be got wrong:
 *
 * - Alerts fire only when a camera's **set of detected classes** changes.
 *   Confidence jitter alone sends nothing, and `detections: []` is the
 *   all-clear. A screen built against a steady drip of frames will misread a
 *   quiet period as a dead feed.
 * - Occupancy pushes only when a zone's **count** changes. No heartbeat.
 *
 * So the scripts below include the awkward cases: an alert that clears and
 * comes back, a wanted detection carrying a face photo, and a zone that drops
 * to zero.
 */

/**
 * Frames arrive on a timer so the screens can be watched behaving over time.
 *
 * Under test that pacing is pure cost: a three-frame script at five seconds
 * apart outlasts Vitest's default timeout before the interesting frame lands.
 * The mock layer is development scaffolding, so it is allowed to know it is
 * being tested; the alternative is either a slow suite or timings too fast to
 * watch in a browser.
 */
const UNDER_TEST = import.meta.env.MODE === 'test'
const FIRST_FRAME_MS = UNDER_TEST ? 10 : 1_500
const INTERVAL_MS = UNDER_TEST ? 20 : 5_000

/* A 1x1 transparent PNG. Stands in for the base64 JPEG the wanted feed sends,
   so the screen can prove it renders one without shipping a picture of a
   person into the repository. */
const FAKE_SNAPSHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function alertScript(feature: AlertFeature): AlertFrame[] {
  if (feature === 'wanted') {
    return [
      { type: 'snapshot', cameras: { 'cam-lobby': [], 'cam-counter': [] } },
      {
        type: 'update',
        camera: 'cam-lobby',
        detections: [
          {
            class: 'MAROUANE-B-2024-114',
            /* Cosine similarity, not a probability - the screen must not
               render this as a percentage. */
            confidence: 0.612,
            bbox: [412, 88, 501, 205],
            det_score: 0.881,
            face_px: 94,
            snapshot: FAKE_SNAPSHOT,
          },
        ],
      },
      /* The all-clear. */
      { type: 'update', camera: 'cam-lobby', detections: [] },
    ]
  }

  if (feature === 'fire') {
    return [
      { type: 'snapshot', cameras: { 'cam-lobby': [], 'cam-store': [] } },
      {
        type: 'update',
        camera: 'cam-store',
        detections: [{ class: 'smoke', confidence: 0.74, bbox: [120, 300, 460, 700] }],
      },
    ]
  }

  if (feature === 'emotion') {
    return [
      { type: 'snapshot', cameras: { 'cam-counter': [] } },
      {
        type: 'update',
        camera: 'cam-counter',
        detections: [{ class: 'angry', confidence: 0.66, bbox: [300, 210, 420, 360] }],
      },
      { type: 'update', camera: 'cam-counter', detections: [] },
    ]
  }

  /* weapon: starts clear, a pistol appears on one camera, then clears, then
     returns. A repeated identical alert means the situation genuinely changed
     and changed back - not a duplicate to be swallowed. */
  return [
    { type: 'snapshot', cameras: { 'cam-lobby': [], 'cam-counter': [] } },
    {
      type: 'update',
      camera: 'cam-counter',
      detections: [{ class: 'pistol', confidence: 0.87, bbox: [900, 332, 1352, 664] }],
    },
    { type: 'update', camera: 'cam-counter', detections: [] },
    {
      type: 'update',
      camera: 'cam-counter',
      detections: [{ class: 'pistol', confidence: 0.83, bbox: [880, 320, 1330, 650] }],
    },
  ]
}

function occupancyScript(): OccupancyFrame[] {
  return [
    {
      type: 'snapshot',
      zones: {
        lobby: {
          count: 4,
          points: [
            [210.5, 533],
            [260, 540],
            [300, 512],
            [180, 498],
          ],
        },
        counters: {
          count: 2,
          points: [
            [620, 300],
            [660, 310],
          ],
        },
        /* Empty from the start: a zone with nobody in it is normal, not a
           missing zone, and the screen has to show it as zero rather than
           omitting the row. */
        vault: { count: 0, points: [] },
      },
    },
    {
      type: 'update',
      zone: 'lobby',
      count: 5,
      points: [
        [210.5, 533],
        [260, 540],
        [300, 512],
        [180, 498],
        [240, 470],
      ],
    },
    {
      type: 'update',
      zone: 'counters',
      count: 3,
      points: [
        [620, 300],
        [660, 310],
        [700, 295],
      ],
    },
    /* Back to zero - the case where a naive "only render non-empty" screen
       leaves a stale count on the wall. */
    { type: 'update', zone: 'lobby', count: 0, points: [] },
  ]
}

/**
 * Workstation statuses, on the same only-on-change rule as the other two.
 *
 * The script is built around the two readings that are easy to get wrong:
 *
 * - `coffre` never leaves `unknown`, with `zone_known: false`. Its zone is on
 *   the Rabat camera, which is OFFLINE and has never produced a frame, so
 *   nothing has ever been measured there. A screen that renders that as "away"
 *   is reporting an empty counter when what it has is a broken camera.
 * - `accueil` is already empty on connect, and stays that way: the reception
 *   desk nobody is at. It matches workstationStore's seed so the list and the
 *   feed agree from the first frame instead of flipping under the reader.
 * - `guichet-3` goes away and comes back. `away` only arrives after the
 *   service's full absence window (300s by default), so it is a slow, real
 *   signal - not a flicker, and not something to show as instant.
 *
 * `since` is epoch SECONDS, as the contract has it, computed from now so the
 * durations on screen read as minutes rather than as 1970.
 */
function workstationScript(): WorkstationFrame[] {
  const now = Date.now() / 1000

  return [
    {
      type: 'snapshot',
      workstations: [
        { name: 'accueil', zone: 'lobby', status: 'away', since: now - 720, zone_known: true },
        {
          name: 'guichet-3',
          zone: 'counters',
          status: 'present',
          since: now - 2_400,
          zone_known: true,
        },
        /* Bound to a zone nothing has ever read. */
        { name: 'coffre', zone: 'vault', status: 'unknown', since: now - 7_200, zone_known: false },
      ],
    },
    {
      type: 'update',
      name: 'guichet-3',
      zone: 'counters',
      status: 'away',
      since: now - 5,
      zone_known: true,
    },
    {
      type: 'update',
      name: 'guichet-3',
      zone: 'counters',
      status: 'present',
      since: now,
      zone_known: true,
    },
  ]
}

function createScriptedStream<T>(frames: T[]): SocketStream<T> {
  const eventListeners = new Set<(event: T) => void>()
  const statusListeners = new Set<(status: StreamStatus) => void>()
  const timers: ReturnType<typeof setTimeout>[] = []

  let status: StreamStatus = 'connecting'
  let stopped = false

  function setStatus(next: StreamStatus) {
    if (status === next || stopped) return
    status = next
    for (const listener of statusListeners) listener(next)
  }

  /* The 'error' scenario models a socket that never comes up, so the badge and
     the stale-data warning can actually be looked at. */
  if (MOCK_SCENARIO === 'error') {
    status = 'closed'
  } else {
    timers.push(
      setTimeout(() => {
        setStatus('open')
        frames.forEach((frame, i) => {
          timers.push(
            setTimeout(() => {
              for (const listener of eventListeners) listener(frame)
            }, i * INTERVAL_MS),
          )
        })
      }, FIRST_FRAME_MS),
    )
  }

  return {
    get status() {
      return status
    },
    subscribe(onEvent) {
      eventListeners.add(onEvent)
      return () => eventListeners.delete(onEvent)
    },
    onStatusChange(listener) {
      statusListeners.add(listener)
      listener(status)
      return () => statusListeners.delete(listener)
    },
    close() {
      stopped = true
      timers.forEach(clearTimeout)
      timers.length = 0
      eventListeners.clear()
      statusListeners.clear()
    },
  }
}

export function createMockAlertStream(feature: AlertFeature): SocketStream<AlertFrame> {
  return createScriptedStream(alertScript(feature))
}

export function createMockOccupancyStream(): SocketStream<OccupancyFrame> {
  return createScriptedStream(occupancyScript())
}

export function createMockWorkstationStream(): SocketStream<WorkstationFrame> {
  return createScriptedStream(workstationScript())
}
