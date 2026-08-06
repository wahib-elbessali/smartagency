import { afterEach, describe, expect, it, vi } from 'vitest'

describe('fetchJson against a real backend', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  async function loadClient() {
    vi.stubEnv('VITE_USE_MOCKS', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test')
    vi.resetModules()
    return {
      client: await import('./client'),
      tokenStore: await import('./tokenStore'),
    }
  }

  it('sends the bearer token on an authenticated endpoint', async () => {
    const { client, tokenStore } = await loadClient()
    tokenStore.setSession({
      accessToken: 'JWT123',
      refreshToken: 'R',
      user: {
        id: 'u1',
        full_name: 'Fatima Abbar',
        email: 'fatima@agency.com',
        role: 'MANAGER',
        agency_id: 'a1',
        is_active: true,
      },
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )

    await client.fetchJson({ key: 'k', path: '/api/employees', auth: true })

    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer JWT123')
    tokenStore.clearSession()
  })

  /* Failing before the request goes out means the screen says "you are signed
     out" instead of having to interpret a bare 401. */
  it('fails with 401 rather than sending an unauthenticated request', async () => {
    const { client, tokenStore } = await loadClient()
    tokenStore.clearSession()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(
      client.fetchJson({ key: 'k', path: '/api/employees', auth: true }),
    ).rejects.toMatchObject({ kind: 'http', status: 401 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never attaches a token to an endpoint that did not ask for one', async () => {
    const { client, tokenStore } = await loadClient()
    tokenStore.setSession({
      accessToken: 'JWT123',
      refreshToken: 'R',
      user: {
        id: 'u1',
        full_name: 'A',
        email: 'a@b.c',
        role: 'ADMIN',
        agency_id: null,
        is_active: true,
      },
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )

    await client.fetchJson({ key: 'k', path: '/api/auth/login', method: 'POST' }, { body: {} })

    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    tokenStore.clearSession()
  })
})
