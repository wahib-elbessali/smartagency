import { USE_MOCKS } from '../config'
import {
  createSocketStream,
  parseJsonFrame,
  type SocketStream,
  type SocketStreamDeps,
} from '../socketStream'
import {
  createMockAlertStream,
  createMockOccupancyStream,
  createMockWorkstationStream,
} from '@/mocks/aiStreams'
import type { AlertFeature, AlertFrame, OccupancyFrame, WorkstationFrame } from '../types'

/**
 * The live AI feeds, every one proxied by the backend.
 *
 * The frontend never talks to the AI service. Decided in the meeting on
 * 2026-08-11: frontend calls backend, backend calls everything else. That
 * matters here more than anywhere - the AI service has no authentication at
 * all, and the wanted feed carries names and face photographs of flagged
 * people. A browser reaching it directly would be an open biometric endpoint.
 *
 * The four alert streams and occupancy are contracts/api.md §13 (added in
 * PR #104): one stream per feature, frames relayed unchanged from the AI
 * service, token in the query string, 1008 for a refused caller and 1013
 * when the AI service is down (socketStream.ts reads both). The workstation
 * stream is not in the contract yet; its path is from
 * backend/app/websocket/ai_proxy.py.
 */

export const ALERT_STREAM_PATHS: Record<AlertFeature, string> = {
  weapon: '/ws/alerts/weapon',
  fire: '/ws/alerts/fire',
  emotion: '/ws/alerts/emotion',
  wanted: '/ws/alerts/wanted',
}

export const OCCUPANCY_STREAM_PATH = '/ws/occupancy'

/* ADMIN, MANAGER and SECURITY (EMPLOYEE_ACTIVITY_ROLES in ai_proxy.py).
   Relays the AI service's whole-site stream: not filtered by agency, no
   employee on a row - see Staffing.tsx for how that is handled. */
export const WORKSTATION_STREAM_PATH = '/ws/employee-activity'

/**
 * Parses an alerts frame.
 *
 * Validates only the discriminant and the one field that carries the payload,
 * for the same reason the attendance parser does: a frame we cannot read is
 * dropped, but a frame carrying an unexpected extra is still real data.
 */
export function parseAlertFrame(data: unknown): AlertFrame | null {
  const frame = parseJsonFrame(data)
  if (!frame) return null

  if (frame.type === 'snapshot') {
    if (typeof frame.cameras !== 'object' || frame.cameras === null) return null
    return frame as unknown as AlertFrame
  }
  if (frame.type === 'update') {
    if (typeof frame.camera !== 'string') return null
    if (!Array.isArray(frame.detections)) return null
    return frame as unknown as AlertFrame
  }
  return null
}

/**
 * Parses an occupancy frame.
 *
 * `people_tracking_ready` (contracts/api.md §13) is defaulted to true when a
 * zone arrives without it. That is not a guess about the room: the field is
 * always true for a pixel zone, and an AI build older than the field has no
 * notion of a world zone waiting on tracking - so absent means what it meant
 * before the field existed. Treating absent as false would blank every count
 * on the screen at once.
 */
export function parseOccupancyFrame(data: unknown): OccupancyFrame | null {
  const frame = parseJsonFrame(data)
  if (!frame) return null

  if (frame.type === 'snapshot') {
    if (typeof frame.zones !== 'object' || frame.zones === null) return null
    const zones = Object.fromEntries(
      Object.entries(frame.zones as Record<string, Record<string, unknown>>).map(([name, zone]) => [
        name,
        withReadiness(zone),
      ]),
    )
    return { ...frame, zones } as unknown as OccupancyFrame
  }
  if (frame.type === 'update') {
    if (typeof frame.zone !== 'string') return null
    if (typeof frame.count !== 'number') return null
    return withReadiness(frame) as unknown as OccupancyFrame
  }
  return null
}

function withReadiness<T extends Record<string, unknown>>(zone: T): T {
  return typeof zone.people_tracking_ready === 'boolean'
    ? zone
    : { ...zone, people_tracking_ready: true }
}

/**
 * A workstation frame.
 *
 * The update case carries a whole row rather than a nested payload, so the
 * discriminant and `name` are what get checked: a frame we cannot attribute
 * to a workstation is useless, while one carrying an unexpected extra field
 * is still real data.
 */
export function parseWorkstationFrame(data: unknown): WorkstationFrame | null {
  const frame = parseJsonFrame(data)
  if (!frame) return null

  if (frame.type === 'snapshot') {
    if (!Array.isArray(frame.workstations)) return null
    return frame as unknown as WorkstationFrame
  }
  if (frame.type === 'update') {
    if (typeof frame.name !== 'string') return null
    return frame as unknown as WorkstationFrame
  }
  return null
}

export function createAlertStream(
  feature: AlertFeature,
  deps: SocketStreamDeps = {},
): SocketStream<AlertFrame> {
  if (USE_MOCKS) return createMockAlertStream(feature)
  return createSocketStream(ALERT_STREAM_PATHS[feature], parseAlertFrame, deps)
}

export function createOccupancyStream(deps: SocketStreamDeps = {}): SocketStream<OccupancyFrame> {
  if (USE_MOCKS) return createMockOccupancyStream()
  return createSocketStream(OCCUPANCY_STREAM_PATH, parseOccupancyFrame, deps)
}

export function createWorkstationStream(
  deps: SocketStreamDeps = {},
): SocketStream<WorkstationFrame> {
  if (USE_MOCKS) return createMockWorkstationStream()
  return createSocketStream(WORKSTATION_STREAM_PATH, parseWorkstationFrame, deps)
}
