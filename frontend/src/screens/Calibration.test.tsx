import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Calibration, { AlignReport } from './Calibration'
import { clearSession, setSession } from '@/api/tokenStore'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { ScopeProvider } from '@/agency/scope'
import type { Camera, Role } from '@/api/types'
import { mockUserForRole } from '@/mocks/currentUser'
import { resetCameraStore } from '@/mocks/cameraStore'
import { AGENCY_ID } from '@/mocks/fixtures/people'
import * as store from '@/mocks/calibrationStore'
import '@/mocks'

/**
 * Same jsdom wall as the Zones screen: no image ever loads, so the SVG
 * overlay is never mounted and points cannot be clicked into place here.
 * What is tested is everything that decides whether the numbers mean
 * anything - the per-camera status list, the two-camera gate on alignment,
 * and the store's rules, which ARE the service's rules.
 *
 * The clicking itself is NOT verified for this screen. Its click-to-
 * coordinate mapping is the same getScreenCTM().inverse() the Zones canvas
 * uses and that one was walked through in Chrome, but this screen's own
 * canvases - the 4-corner quad and the multi-camera align grid - have not
 * been driven by hand yet. Saying so rather than implying the coverage.
 */
function renderAs(role: Role) {
  const user = mockUserForRole(role)
  setSession({ accessToken: 'mock-token', refreshToken: 'mock-refresh', user })

  const session: SessionValue = {
    status: 'authenticated',
    user,
    signIn: async () => {},
    signOut: () => {},
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={session}>
        <ScopeProvider>
          <MemoryRouter>
            <Calibration />
          </MemoryRouter>
        </ScopeProvider>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

const SQUARE: Array<[number, number]> = [
  [100, 100],
  [500, 110],
  [520, 500],
  [90, 490],
]

/* The AI side addresses cameras by name (cameraStore's seeded names). */
const LOBBY = 'cam-lobby'
const COUNTER = 'cam-counter'

describe('Calibration', () => {
  beforeEach(() => {
    store.resetCalibrationStore()
    resetCameraStore()
  })
  afterEach(clearSession)

  it('shows every camera as uncalibrated until one is done', async () => {
    renderAs('MANAGER')

    const list = await screen.findByRole('heading', { name: /this branch's cameras/i }, WAIT)
    expect(list).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('not calibrated')).toHaveLength(2), WAIT)
  })

  it('reads a saved calibration back as calibrated but not yet aligned', async () => {
    store.calibrateRect({
      camera: LOBBY,
      points: SQUARE,
      img_w: 1920,
      img_h: 1080,
    })
    renderAs('MANAGER')

    expect(await screen.findByText('not aligned', {}, WAIT)).toBeInTheDocument()
    expect(screen.getAllByText('not calibrated')).toHaveLength(1)
  })

  /* Alignment reconciles cameras with each other, so one camera is not a
     thing to align - the screen says so instead of offering the button. */
  it('refuses to offer alignment until two cameras are calibrated', async () => {
    const user = userEvent.setup()
    store.calibrateRect({
      camera: LOBBY,
      points: SQUARE,
      img_w: 1920,
      img_h: 1080,
    })
    renderAs('MANAGER')
    await screen.findByText('not aligned', {}, WAIT)

    await user.click(screen.getByRole('button', { name: /align the cameras/i }))

    expect(
      await screen.findByRole('heading', { name: /calibrate at least two cameras first/i }, WAIT),
    ).toBeInTheDocument()
    expect(screen.getByText(/One is done\./)).toBeInTheDocument()
  })

  it('offers both canvases once two cameras are calibrated', async () => {
    const user = userEvent.setup()
    for (const camera of [LOBBY, COUNTER]) {
      store.calibrateRect({ camera, points: SQUARE, img_w: 1920, img_h: 1080 })
    }
    renderAs('MANAGER')
    await waitFor(() => expect(screen.getAllByText('not aligned')).toHaveLength(2), WAIT)

    await user.click(screen.getByRole('button', { name: /align the cameras/i }))

    expect(
      await screen.findByRole('heading', { name: /click one real spot in each camera/i }, WAIT),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'cam-lobby' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'cam-counter' })).toBeInTheDocument()
    /* Nothing recorded yet, so the solve is not offered. */
    expect(screen.getByRole('button', { name: /^align the cameras$/i })).toBeDisabled()
  })

  /* The backend gateway has no route for the AI service's
     DELETE /calibration/{camera}, so there is nothing for a button to call.
     Pinned so one does not come back pointing at a 404. */
  it('offers no way to forget a calibration', async () => {
    store.calibrateRect({
      camera: LOBBY,
      points: SQUARE,
      img_w: 1920,
      img_h: 1080,
    })
    renderAs('MANAGER')
    await screen.findByText('not aligned', {}, WAIT)

    expect(screen.queryByRole('button', { name: /forget calibration/i })).not.toBeInTheDocument()
  })

  it('keeps another branch’s calibration out of a manager’s list', async () => {
    const { fetchCalibration } = await import('@/api/endpoints/calibration')
    store.calibrateRect({
      camera: 'cam-store',
      points: SQUARE,
      img_w: 1920,
      img_h: 1080,
    })
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })

    /* The gateway narrows this read to the agency's own camera names. */
    await expect(fetchCalibration(AGENCY_ID)).resolves.toHaveLength(0)
  })
})

/**
 * The store reproduces the service's behaviour, not its mathematics - the
 * rules a screen can get wrong, rather than numbers it cannot fake.
 */
describe('calibrationStore', () => {
  beforeEach(store.resetCalibrationStore)

  it('demands exactly four points', () => {
    expect(() =>
      store.calibrateRect({
        camera: LOBBY,
        points: SQUARE.slice(0, 3),
        img_w: 1920,
        img_h: 1080,
      }),
    ).toThrowError(/4 points/)
  })

  it('refuses a degenerate quad, as the real solve does', () => {
    expect(() =>
      store.calibrateRect({
        camera: LOBBY,
        points: [
          [100, 100],
          [102, 100],
          [103, 101],
          [101, 101],
        ],
        img_w: 1920,
        img_h: 1080,
      }),
    ).toThrowError(/trop proches|alignes/)
  })

  it('leaves a freshly calibrated camera unaligned', () => {
    const result = store.calibrateRect({
      camera: LOBBY,
      points: SQUARE,
      img_w: 1920,
      img_h: 1080,
    })
    expect(result.aligned).toBe(false)
    expect(result.calib_res).toEqual([1920, 1080])
  })

  it('needs two calibrated cameras before it will align anything', () => {
    store.calibrateRect({ camera: LOBBY, points: SQUARE, img_w: 1920, img_h: 1080 })
    expect(() => store.alignCameras([])).toThrowError(/deux cameras/)
  })

  /**
   * The case worth pinning: a camera nothing connects to comes back
   * `aligned: false` WITH the call succeeding. A screen that treats 200 as
   * success reports a site that agrees with itself when it does not.
   */
  it('reports an unreachable camera per-camera rather than failing the call', () => {
    store.calibrateRect({ camera: LOBBY, points: SQUARE, img_w: 1920, img_h: 1080 })
    store.calibrateRect({ camera: COUNTER, points: SQUARE, img_w: 1920, img_h: 1080 })

    const result = store.alignCameras([{ [LOBBY]: [10, 10] }])

    expect(result.results[COUNTER].aligned).toBe(false)
    expect(result.results[COUNTER].error).toMatch(/no chain of >=2-point/)
  })

  it('aligns on two shared points, and says the fit was weak below four', () => {
    store.calibrateRect({ camera: LOBBY, points: SQUARE, img_w: 1920, img_h: 1080 })
    store.calibrateRect({ camera: COUNTER, points: SQUARE, img_w: 1920, img_h: 1080 })

    const result = store.alignCameras([
      { [LOBBY]: [10, 10], [COUNTER]: [20, 20] },
      { [LOBBY]: [30, 30], [COUNTER]: [40, 40] },
    ])

    expect(result.results[COUNTER]).toMatchObject({ aligned: true, n_points: 2 })
    expect(result.weak_fits).toMatch(/<4 shared points/)
    expect(Object.values(store.listCalibration()).every((entry) => entry.diagnostics.aligned)).toBe(
      true,
    )
  })

  /* Re-measuring a camera changes its floor frame, so whatever it was
     reconciled with no longer holds. */
  it('drops alignment when a camera is recalibrated', () => {
    store.calibrateRect({ camera: LOBBY, points: SQUARE, img_w: 1920, img_h: 1080 })
    store.calibrateRect({ camera: COUNTER, points: SQUARE, img_w: 1920, img_h: 1080 })
    store.alignCameras([
      { [LOBBY]: [10, 10], [COUNTER]: [20, 20] },
      { [LOBBY]: [30, 30], [COUNTER]: [40, 40] },
    ])

    store.calibrateRect({ camera: COUNTER, points: SQUARE, img_w: 1920, img_h: 1080 })

    expect(store.listCalibration()[COUNTER]?.diagnostics.aligned).toBe(false)
  })
})

/**
 * Alignment is site-wide underneath, and the gateway returns every camera the
 * AI service aligned. The report must speak only about this branch's own.
 */
describe('AlignReport', () => {
  const camera = (name: string): Camera => ({
    id: name,
    agency_id: 'a',
    name,
    stream_url: 'rtsp://x',
    status: 'ONLINE',
  })

  it('keeps another branch’s cameras out of the report', () => {
    render(
      <AlignReport
        cameras={[camera('cam-lobby'), camera('cam-counter')]}
        result={{
          reference: 'cam-store',
          results: {
            'cam-store': { aligned: true, reference: true, n_points: null, via: null },
            'cam-lobby': { aligned: true, reference: false, n_points: 2, via: 'cam-store' },
            'cam-counter': { aligned: true, reference: false, n_points: 5, via: 'cam-store' },
          },
          residual_checks: [
            {
              pairs: [
                { cam_a: 'cam-lobby', cam_b: 'cam-store', distance_cm: 900 },
                { cam_a: 'cam-lobby', cam_b: 'cam-counter', distance_cm: 3.5 },
              ],
            },
          ],
          weak_fits: 'camera(s) cam-lobby, cam-store were aligned with <4 shared points',
        }}
      />,
    )

    expect(screen.queryByText(/cam-store/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/a camera in another branch/).length).toBeGreaterThan(0)
    /* The weak-fit note is rebuilt from this branch's rows, not echoed. */
    expect(screen.getByText(/cam-lobby was aligned on fewer than 4/)).toBeInTheDocument()
    /* Only the pair wholly inside the branch feeds the residual. */
    expect(screen.getByText(/3\.5\s*cm/)).toBeInTheDocument()
  })
})
