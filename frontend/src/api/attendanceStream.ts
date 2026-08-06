import {
  USE_MOCKS,
  WS_AUTH_MODE,
  WS_AUTH_QUERY_PARAM,
  WS_BASE_URL,
  WS_MAX_INITIAL_ATTEMPTS,
  WS_RECONNECT_MS,
} from './config'
import { getAccessToken } from './tokenStore'
import { createMockAttendanceStream } from '@/mocks/attendanceStream'
import type { AttendanceEvent } from './types'

/**
 * The live attendance transport, isolated behind one module.
 *
 * This replaces the old alertsStream.ts stub. Two things changed and both are
 * deliberate:
 *
 * 1. It is a real WebSocket now. contracts/api.md settles the question that
 *    file was waiting on: `WS /ws/attendance`. EventSource was never going to
 *    work against that - it speaks Server-Sent Events and cannot open a
 *    WebSocket at all.
 *
 * 2. It is called "attendance", not "alerts". The socket carries check-ins and
 *    check-outs. Leaving "alerts" in the name is how a feed of people arriving
 *    at work quietly ends up rendered on a security-alerts screen, and the
 *    project brief has genuine alerts - weapons, fire, intruders - that this is
 *    not. StreamStatus and StreamStatusBadge are unchanged and still shared.
 */

export type StreamStatus =
  | 'idle' // never connected
  | 'connecting'
  | 'open'
  | 'reconnecting' // dropped, trying again
  | 'closed' // deliberately stopped, or cannot run

export interface AttendanceStream {
  readonly status: StreamStatus
  /** Returns an unsubscribe function. */
  subscribe(onEvent: (event: AttendanceEvent) => void): () => void
  /** Returns an unsubscribe function. Fires immediately with the current status. */
  onStatusChange(listener: (status: StreamStatus) => void): () => void
  close(): void
}

export const ATTENDANCE_STREAM_PATH = '/ws/attendance'

/**
 * Builds the socket URL and the subprotocol list.
 *
 * Returns null when we cannot connect honestly - no token, or no configured way
 * to present it. Returning null (rather than connecting anyway and hoping) is
 * what makes the badge say "Not connected" instead of showing a calm, empty,
 * silently-unauthenticated list.
 */
export function buildSocketTarget(
  token: string | null,
  mode = WS_AUTH_MODE,
  base = WS_BASE_URL,
): { url: string; protocols?: string[] } | null {
  if (!base || !token || !mode) return null

  const url = new URL(`${base}${ATTENDANCE_STREAM_PATH}`)
  url.searchParams.set(WS_AUTH_QUERY_PARAM, token)
  /* Worth knowing: a token in a query string lands in server and proxy access
     logs. The subprotocol field avoids that, but the backend returns 403 for it
     - tested - so this is the only option that works today. */
  return { url: url.toString() }
}

/** Full jitter exponential backoff, so N reconnecting dashboards don't sync up. */
export function backoffDelay(attempt: number): number {
  const { min, max } = WS_RECONNECT_MS
  const ceiling = Math.min(max, min * 2 ** attempt)
  return min + Math.random() * (ceiling - min)
}

interface StreamDeps {
  /** Injectable for tests; defaults to the browser's WebSocket. */
  socketFactory?: (url: string, protocols?: string[]) => WebSocket
  tokenProvider?: () => string | null
  scheduleRetry?: (fn: () => void, ms: number) => number
  cancelRetry?: (handle: number) => void
}

export function createLiveAttendanceStream(deps: StreamDeps = {}): AttendanceStream {
  const {
    socketFactory = (url, protocols) => new WebSocket(url, protocols),
    tokenProvider = getAccessToken,
    scheduleRetry = (fn, ms) => setTimeout(fn, ms) as unknown as number,
    cancelRetry = (handle) => clearTimeout(handle),
  } = deps

  const eventListeners = new Set<(event: AttendanceEvent) => void>()
  const statusListeners = new Set<(status: StreamStatus) => void>()

  let status: StreamStatus = 'idle'
  let socket: WebSocket | null = null
  let retryHandle: number | null = null
  let attempt = 0
  let stopped = false
  /* Once true, drops stay retryable forever - see WS_MAX_INITIAL_ATTEMPTS. */
  let hasEverOpened = false

  function setStatus(next: StreamStatus) {
    if (status === next) return
    status = next
    for (const listener of statusListeners) listener(next)
  }

  function connect() {
    if (stopped) return

    const target = buildSocketTarget(tokenProvider())
    if (!target) {
      /* No token, or VITE_WS_AUTH_MODE is unset. Either way there is nothing
         honest to connect to, and retrying forever would just spin. */
      setStatus('closed')
      return
    }

    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    let ws: WebSocket
    try {
      ws = socketFactory(target.url, target.protocols)
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws

    ws.onopen = () => {
      attempt = 0
      hasEverOpened = true
      setStatus('open')
    }

    ws.onmessage = (message: MessageEvent) => {
      const parsed = parseFrame(message.data)
      /* A frame we cannot read is dropped, not thrown. One malformed message
         must not take down a dashboard that is otherwise fine. */
      if (!parsed) return
      for (const listener of eventListeners) listener(parsed)
    }

    ws.onerror = () => {
      /* onerror is always followed by onclose, so reconnecting is handled
         there - doing it in both places double-schedules. */
    }

    ws.onclose = () => {
      socket = null
      if (stopped) {
        setStatus('closed')
        return
      }
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (!hasEverOpened && attempt >= WS_MAX_INITIAL_ATTEMPTS) {
      /* Never connected once. Something is wrong with the token or the config,
         and no amount of retrying fixes either. "Not connected" is the honest
         status; "Reconnecting..." forever is not. */
      setStatus('closed')
      return
    }

    setStatus('reconnecting')
    const delay = backoffDelay(attempt)
    attempt += 1
    retryHandle = scheduleRetry(() => {
      retryHandle = null
      connect()
    }, delay)
  }

  connect()

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
      if (retryHandle !== null) {
        cancelRetry(retryHandle)
        retryHandle = null
      }
      eventListeners.clear()
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      setStatus('closed')
      statusListeners.clear()
    },
  }
}

/** Parses a socket frame, returning null for anything unreadable. */
export function parseFrame(data: unknown): AttendanceEvent | null {
  if (typeof data !== 'string') return null

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null) return null

  const frame = value as Record<string, unknown>
  if (typeof frame.type !== 'string') return null
  if (typeof frame.employee_id !== 'string') return null
  if (typeof frame.check_in !== 'string') return null

  return frame as unknown as AttendanceEvent
}

export function createAttendanceStream(deps: StreamDeps = {}): AttendanceStream {
  if (USE_MOCKS) return createMockAttendanceStream()
  return createLiveAttendanceStream(deps)
}
