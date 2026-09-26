import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The two close codes the backend documents (contracts/api.md §13), which
 * both arrive AFTER an accepted handshake - so `onopen` fires first, and
 * only the code tells them apart from an ordinary drop.
 *
 * Harnessed the same way as attendanceStream.test.ts: the module reads its
 * WS config at import time and it is unset by default, so the env is stubbed
 * and the module re-imported to reach the connected path.
 */
describe('createSocketStream close codes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function harness() {
    vi.stubEnv('VITE_USE_MOCKS', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubEnv('VITE_WS_AUTH_MODE', 'query')
    vi.resetModules()

    const mod = await import('./socketStream')

    const sockets: WebSocket[] = []
    const pending: Array<() => void> = []
    const delays: number[] = []
    const statuses: string[] = []
    let token = 'jwt-1'

    const stream = mod.createSocketStream('/ws/alerts/weapon', (data) => data, {
      tokenProvider: () => token,
      socketFactory: () => {
        const ws = { close: () => {} } as unknown as WebSocket
        sockets.push(ws)
        return ws
      },
      scheduleRetry: (fn, ms) => {
        pending.push(fn)
        delays.push(ms)
        return pending.length
      },
      cancelRetry: () => {},
    })
    stream.onStatusChange((status) => statuses.push(status))

    const last = () => sockets[sockets.length - 1]
    return {
      stream,
      sockets,
      delays,
      statuses,
      refreshToken: () => {
        token = 'jwt-2'
      },
      open: () => last().onopen?.(new Event('open')),
      message: () => last().onmessage?.(new MessageEvent('message', { data: '{}' })),
      close: (code: number) => last().onclose?.(new CloseEvent('close', { code })),
      runPendingRetry: () => pending.shift()?.(),
    }
  }

  /* 1008 is the backend saying this token or role may not read the stream.
     The same token will get the same answer, so it stops - it does not sit
     on "Reconnecting..." forever against a refusal. */
  it('stops on 1008 and says the caller was refused', async () => {
    const h = await harness()
    h.open()
    h.close(1008)

    expect(h.stream.status).toBe('refused')
    h.runPendingRetry()
    expect(h.sockets).toHaveLength(1)
  })

  /* ...unless the token changed since that socket connected: an expired one
     refreshed by a REST call deserves one more try. */
  it('retries a 1008 once the token has been refreshed', async () => {
    const h = await harness()
    h.open()
    h.refreshToken()
    h.close(1008)

    expect(h.stream.status).toBe('reconnecting')
    h.runPendingRetry()
    expect(h.sockets).toHaveLength(2)
  })

  /* 1013 is the AI service being down behind a healthy backend. The accept
     before each close is not recovery, so the badge must not flash "Live"
     and the backoff must keep growing instead of resetting on every accept. */
  it('backs off on 1013 without flashing live between attempts', async () => {
    const h = await harness()
    h.open()
    expect(h.stream.status).toBe('open')

    h.close(1013)
    expect(h.stream.status).toBe('unavailable')

    const liveCountBefore = h.statuses.filter((s) => s === 'open').length
    for (let i = 0; i < 6; i += 1) {
      h.runPendingRetry()
      h.open()
      h.close(1013)
    }

    expect(h.stream.status).toBe('unavailable')
    expect(h.statuses.filter((s) => s === 'open')).toHaveLength(liveCountBefore)
    expect(h.statuses).not.toContain('reconnecting')
    expect(h.delays.length).toBeGreaterThanOrEqual(7)
  })

  /* With the jitter pinned to its top, every delay IS the ceiling - so a
     backoff that reset on each accept would repeat the first delay. */
  it('grows the delay across repeated 1013s', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const h = await harness()
    h.open()
    for (let i = 0; i < 4; i += 1) {
      h.close(1013)
      h.runPendingRetry()
      h.open()
    }
    vi.restoreAllMocks()

    expect(h.delays).toHaveLength(4)
    expect(h.delays[3]).toBeGreaterThan(h.delays[0])
  })

  /* A real frame is what proves the source is back. */
  it('goes live again on the first frame after a 1013', async () => {
    const h = await harness()
    h.open()
    h.close(1013)
    h.runPendingRetry()
    h.open()
    expect(h.stream.status).toBe('unavailable')

    h.message()
    expect(h.stream.status).toBe('open')
  })

  /* An ordinary drop after a healthy connection keeps the old behaviour. */
  it('treats any other close as a drop to reconnect from', async () => {
    const h = await harness()
    h.open()
    h.close(1006)

    expect(h.stream.status).toBe('reconnecting')
    h.runPendingRetry()
    expect(h.sockets).toHaveLength(2)
  })
})
