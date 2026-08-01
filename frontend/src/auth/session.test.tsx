import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from './session'
import { useSession } from './SessionContext'
import { ApiError } from '@/api/errors'

describe('useSession', () => {
  it('starts anonymous', () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })
    expect(result.current.status).toBe('anonymous')
  })

  /* Pins the honest failure. If someone later wires signIn to an invented
     endpoint, this test is what stops it going in quietly. */
  it('fails sign-in with not_implemented until the contract defines an endpoint', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: SessionProvider })

    let thrown: unknown
    await act(async () => {
      try {
        await result.current.signIn({ username: 'a', password: 'b' })
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(ApiError)
    expect((thrown as ApiError).kind).toBe('not_implemented')
    expect(result.current.status).toBe('anonymous')
  })
})
