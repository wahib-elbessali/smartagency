import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from './session'
import { useSession } from './SessionContext'
import { getAccessToken } from '@/api/tokenStore'
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
