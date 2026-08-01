/**
 * The alerts transport, isolated behind one module.
 *
 * Why this file exists: `EventSource` is the browser's Server-Sent Events
 * client and cannot connect to a WebSocket - not "needs tweaking", it will not
 * work. contracts/api.md's template anticipates `### WS /path` and never
 * mentions SSE, so the transport for /alerts is genuinely undecided and is
 * Ahmed's call.
 *
 * So no component ever constructs a transport itself. They consume this
 * interface, and picking SSE or WebSocket later is a change to this file only.
 *
 * Event payloads are typed `unknown` on purpose: the alert shape is not in the
 * contract yet, and a plausible-looking guess would be worse than nothing.
 */

export type StreamStatus =
  | 'idle' // never connected
  | 'connecting'
  | 'open'
  | 'reconnecting' // dropped, trying again
  | 'closed' // deliberately stopped, or cannot run

export interface AlertsStream {
  /** Current status, for a first render before any event arrives. */
  readonly status: StreamStatus
  /** Returns an unsubscribe function. */
  subscribe(onEvent: (event: unknown) => void): () => void
  /** Returns an unsubscribe function. */
  onStatusChange(listener: (status: StreamStatus) => void): () => void
  close(): void
}

/**
 * Stands in until the transport is decided. It connects to nothing and reports
 * `closed`, which is the honest state - an alerts view built against this shows
 * "not connected" rather than an empty list that looks calm.
 */
function createUnconfiguredStream(): AlertsStream {
  const statusListeners = new Set<(status: StreamStatus) => void>()

  return {
    status: 'closed',
    subscribe() {
      return () => {}
    },
    onStatusChange(listener) {
      statusListeners.add(listener)
      listener('closed')
      return () => statusListeners.delete(listener)
    },
    close() {
      statusListeners.clear()
    },
  }
}

export function createAlertsStream(): AlertsStream {
  return createUnconfiguredStream()
}
