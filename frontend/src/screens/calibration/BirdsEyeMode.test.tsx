import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BirdsEyeMode } from './BirdsEyeMode'
import { clearSession, setSession } from '@/api/tokenStore'
import type { CameraCalibration } from '@/api/types'
import { mockUserForRole } from '@/mocks/currentUser'
import {
  CAMERA_ID_COUNTER,
  CAMERA_ID_LOBBY,
  getCamera,
  resetCameraStore,
} from '@/mocks/cameraStore'
import * as calibrationStore from '@/mocks/calibrationStore'
import '@/mocks'

/**
 * The bird's-eye check's wiring: which layers are drawn, with which warp,
 * and what the coverage panel is allowed to claim. Whether the warp LOOKS
 * right is a browser question (checked in Chrome); the maths behind it is
 * tested in geometry/homography.test.ts.
 */
const SQUARE: Array<[number, number]> = [
  [100, 100],
  [500, 100],
  [500, 500],
  [100, 500],
]

function byCameraFromStore(): Map<string, CameraCalibration> {
  return new Map(
    Object.entries(calibrationStore.listCalibration()).map(([camera, entry]) => [
      camera,
      { camera, Hinv: entry.Hinv, diagnostics: entry.diagnostics },
    ]),
  )
}

function renderBirdsEye() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BirdsEyeMode
        cameras={[getCamera(CAMERA_ID_COUNTER), getCamera(CAMERA_ID_LOBBY)]}
        byCamera={byCameraFromStore()}
      />
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

describe("bird's-eye check", () => {
  beforeEach(() => {
    resetCameraStore()
    calibrationStore.resetCalibrationStore()
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:frame'),
      revokeObjectURL: vi.fn(),
    })
    for (const camera of ['cam-lobby', 'cam-counter']) {
      calibrationStore.calibrateRect({ camera, points: SQUARE, img_w: 1920, img_h: 1080 })
    }
    calibrationStore.alignCameras([
      { 'cam-counter': [100, 100], 'cam-lobby': [150, 100] },
      { 'cam-counter': [400, 300], 'cam-lobby': [450, 300] },
    ])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('lays every included camera onto the floor, blended', async () => {
    renderBirdsEye()
    const counter = await screen.findByRole(
      'img',
      { name: 'cam-counter laid onto the floor' },
      WAIT,
    )
    const lobby = await screen.findByRole('img', { name: 'cam-lobby laid onto the floor' }, WAIT)
    /* The warp is a CSS homography, and two layers share the opacity. */
    expect(counter.style.transform).toMatch(/^matrix3d\(/)
    expect(counter.style.opacity).toBe('0.5')
    expect(lobby.style.clipPath).toMatch(/^polygon\(/)
  })

  it('shows one camera alone on the same scale, and drops an excluded one', async () => {
    const user = userEvent.setup()
    renderBirdsEye()
    const before = await screen.findByRole('img', { name: 'cam-counter laid onto the floor' }, WAIT)
    const transform = before.style.transform

    await user.selectOptions(screen.getByLabelText('View'), 'cam-counter')
    const alone = await screen.findByRole('img', { name: 'cam-counter laid onto the floor' }, WAIT)
    expect(
      screen.queryByRole('img', { name: 'cam-lobby laid onto the floor' }),
    ).not.toBeInTheDocument()
    expect(alone.style.opacity).toBe('1')
    /* Same S for solo and blend, so the floor does not move. */
    expect(alone.style.transform).toBe(transform)

    await user.selectOptions(screen.getByLabelText('View'), '')
    await user.click(screen.getByRole('checkbox', { name: /cam-lobby/ }))
    await waitFor(() =>
      expect(
        screen.queryByRole('img', { name: 'cam-lobby laid onto the floor' }),
      ).not.toBeInTheDocument(),
    )
  })

  /* The reference is explicit: a clean coverage result is not a green light. */
  it('words a clean coverage result as the weak check it is', async () => {
    renderBirdsEye()
    expect(
      await screen.findByText(/No gross outlier — which is all this check can say/),
    ).toBeInTheDocument()
    expect(screen.getByText(/does not mean the calibration is right/)).toBeInTheDocument()
  })
})
