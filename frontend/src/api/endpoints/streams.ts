import { USE_MOCKS } from '../config'
import {
  createSocketStream,
  parseJsonFrame,
  type SocketStream,
  type SocketStreamDeps,
} from '../socketStream'
import { createMockAlertStream, createMockOccupancyStream } from '@/mocks/aiStreams'
import type { AlertFeature, AlertFrame, OccupancyFrame } from '../types'

/**
 * The alerts and occupancy feeds, both proxied by the backend.
 *
 * The frontend never talks to the AI service. Decided in the meeting on
 * 2026-08-11: frontend calls backend, backend calls everything else, and
 * exceptions get announced. That matters here more than anywhere - the AI
 * service has no authentication at all, and the wanted feed carries names and
 * face photographs of flagged people. A browser reaching it directly would be
 * an open biometric endpoint.
 *
 * ⚠ THE PATHS BELOW ARE PROVISIONAL.
 *
 * Ahmed is writing the proxy and the contract entries. Until those land the
 * exact backend paths are unknown, so they live here as named constants and
 * nowhere else - swapping them is a one-line change per stream, and mock mode
 * never reads them at all.
 *
 * The open question is whether the backend keeps one stream per feature, as
 * the AI service does, or merges all four into a single `/alerts`. This file
 * assumes per-feature because that mirrors the service. If it turns out to be
 * merged, a merged frame needs a field naming which feature produced a
 * detection - otherwise a pistol and a face off the watchlist are
 * indistinguishable. Raised; awaiting an answer.
 */

export const ALERT_STREAM_PATHS: Record<AlertFeature, string> = {
  weapon: '/ws/alerts/weapon',
  fire: '/ws/alerts/fire',
  emotion: '/ws/alerts/emotion',
  wanted: '/ws/alerts/wanted',
}

export const OCCUPANCY_STREAM_PATH = '/ws/occupancy'

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

export function parseOccupancyFrame(data: unknown): OccupancyFrame | null {
  const frame = parseJsonFrame(data)
  if (!frame) return null

  if (frame.type === 'snapshot') {
    if (typeof frame.zones !== 'object' || frame.zones === null) return null
    return frame as unknown as OccupancyFrame
  }
  if (frame.type === 'update') {
    if (typeof frame.zone !== 'string') return null
    if (typeof frame.count !== 'number') return null
    return frame as unknown as OccupancyFrame
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
