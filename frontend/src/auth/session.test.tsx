import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from './session'
import { useSession } from './SessionContext'
import { getAccessToken } from '@/api/tokenStore'
import { attemptRefresh, resetSessionBridge } from '@/api/sessionBridge'
import '@/mocks'

describe('useSession', () => {
  it('starts anonymous, because the token is held in memory and cannot survive a reload', () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })
    expect(result.current.status).toBe('anonymous')
    expect(result.current.user).toBeNull()
  })

  it('signs in against the contract-shaped login fixture', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })

    await act(async () => {
      await result.current.signIn({ email: 'fatima@agency.com', password: 'whatever' })
    })

    expect(result.current.status).toBe('authenticated')
    expect(result.current.user?.role).toBe('MANAGER')
    expect(getAccessToken()).toBe('FIXTURE.ACCESS.TOKEN')
  })

  it('drops the token on sign-out', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })

    await act(async () => {
      await result.current.signIn({ email: 'fatima@agency.com', password: 'whatever' })
    })
    act(() => result.current.signOut())

    expect(result.current.status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })
})

describe('keeping the session alive', () => {
  afterEach(() => {
    resetSessionBridge()
    vi.useRealTimers()
  })

  /* The whole point: access tokens last 30 minutes, and a wall dashboard has
     nobody sitting in front of it to sign back in. */
  it('registers a refresh handler that client.ts can reach', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })

    await act(async () => {
      await result.current.signIn({ email: 'fatima@agency.com', password: 'whatever' })
    })
    expect(getAccessToken()).toBe('FIXTURE.ACCESS.TOKEN')

    /* client.ts calls this on a 401 without importing this module. */
    await act(async () => {
      expect(await attemptRefresh()).toBe(true)
    })

    await waitFor(() => {
      expect(getAccessToken()).toBe('FIXTURE.ACCESS.TOKEN.REFRESHED')
    })
    expect(result.current.status).toBe('authenticated')
  })

  it('signs out when the refresh token is no longer accepted', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })

    await act(async () => {
      await result.current.signIn({ email: 'fatima@agency.com', password: 'whatever' })
    })

    /* Nothing recovers from a rejected refresh token, so the session has to end
       cleanly rather than sit in a half-authenticated state. */
    const auth = await import('@/api/endpoints/auth')
    vi.spyOn(auth, 'refreshSession').mockRejectedValue(new Error('rejected'))

    await act(async () => {
      expect(await attemptRefresh()).toBe(false)
    })

    expect(result.current.status).toBe('anonymous')
    expect(result.current.user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })
})
