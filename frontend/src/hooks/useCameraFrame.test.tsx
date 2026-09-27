import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCameraFrame } from './useCameraFrame'
import { clearSession, setSession } from '@/api/tokenStore'
import { mockUserForRole } from '@/mocks/currentUser'
import {
  CAMERA_ID_COUNTER,
  CAMERA_ID_LOBBY,
  getCamera,
  resetCameraStore,
} from '@/mocks/cameraStore'
import '@/mocks'

/**
 * The bug this hook exists to close: switching camera left the previous
 * camera's picture and natural size in place until the next frame arrived,
 * so a click in that window was measured in the wrong picture. The switch
 * must clear both in the same render.
 */
describe('useCameraFrame', () => {
  let made = 0
  beforeEach(() => {
    resetCameraStore()
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })
    made = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:frame-${++made}`),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  it('drops the old picture and size the moment the camera changes', async () => {
    const lobby = getCamera(CAMERA_ID_LOBBY)
    const counter = getCamera(CAMERA_ID_COUNTER)
    const { result, rerender } = renderHook(
      ({ camera }) => useCameraFrame(camera, { hold: true }),
      {
        wrapper,
        initialProps: { camera: lobby },
      },
    )

    await waitFor(() => expect(result.current.src).not.toBeNull())
    result.current.onLoad({
      currentTarget: { naturalWidth: 1920, naturalHeight: 1080 },
    } as unknown as React.SyntheticEvent<HTMLImageElement>)
    await waitFor(() => expect(result.current.size).toEqual({ w: 1920, h: 1080 }))

    rerender({ camera: counter })
    /* Same render as the switch - not after the next frame lands. */
    expect(result.current.src).toBeNull()
    expect(result.current.size).toBeNull()

    await waitFor(() => expect(result.current.src).not.toBeNull())
  })

  /* Found in the browser: a frame already in flight when the hold began
     landed afterwards and swapped the picture under a placed point. */
  it('keeps the held picture even when a newer frame lands', async () => {
    const lobby = getCamera(CAMERA_ID_LOBBY)
    const { result, rerender } = renderHook(({ hold }) => useCameraFrame(lobby, { hold }), {
      wrapper,
      initialProps: { hold: false },
    })
    await waitFor(() => expect(result.current.src).not.toBeNull())
    rerender({ hold: true })
    const held = result.current.src

    /* A refetch now resolves with a new blob; the screen must not follow it. */
    result.current.refetch()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.current.src).toBe(held)

    rerender({ hold: false })
    await waitFor(() => expect(result.current.src).not.toBe(held))
  })
})
