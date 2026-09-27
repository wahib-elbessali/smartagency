import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalibrateMode } from './CalibrateMode'
import { AlignMode } from './AlignMode'
import { GatesMode } from './GatesMode'
import { clearSession, setSession } from '@/api/tokenStore'
import type { Camera, CameraCalibration } from '@/api/types'
import { mockUserForRole } from '@/mocks/currentUser'
import {
  CAMERA_ID_COUNTER,
  CAMERA_ID_LOBBY,
  getCamera,
  resetCameraStore,
} from '@/mocks/cameraStore'
import * as calibrationStore from '@/mocks/calibrationStore'
import { AGENCY_ID } from '@/mocks/fixtures/people'
import '@/mocks'
import { canvasFor, clickAt, loadPictures, stubSvgGeometry } from '@/test/canvas'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const WAIT = { timeout: 4000 }

describe('calibration tools', () => {
  beforeEach(() => {
    resetCameraStore()
    calibrationStore.resetCalibrationStore()
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })
    stubSvgGeometry()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearSession()
  })

  describe('the 4th corner', () => {
    function renderCalibrate() {
      const cameras: Camera[] = [getCamera(CAMERA_ID_LOBBY)]
      return wrap(
        <CalibrateMode
          agencyId={AGENCY_ID}
          cameras={cameras}
          byCamera={new Map()}
          onSaved={() => {}}
        />,
      )
    }

    it('is placed by parallelogram completion after three clicks', async () => {
      renderCalibrate()
      await loadPictures()
      const svg = canvasFor('cam-lobby')

      clickAt(svg, 100, 100)
      clickAt(svg, 500, 110)
      clickAt(svg, 520, 400)

      /* corner4 = corner1 + corner3 - corner2 = (120, 390). */
      expect(
        await screen.findByRole('button', { name: /Corner 4, at 120, 390/ }),
      ).toBeInTheDocument()
      expect(screen.getByText(/is a guess/)).toBeInTheDocument()
    })

    it('moves with the arrow keys, and is what gets computed', async () => {
      const user = userEvent.setup()
      const spy = vi.spyOn(calibrationStore, 'calibrateRect')
      renderCalibrate()
      await loadPictures()
      const svg = canvasFor('cam-lobby')
      clickAt(svg, 100, 100)
      clickAt(svg, 500, 110)
      clickAt(svg, 520, 400)

      const handle = await screen.findByRole('button', { name: /Corner 4/ })
      handle.focus()
      await user.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowDown}')
      expect(screen.getByRole('button', { name: /Corner 4, at 130, 391/ })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Compute and save' }))
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), WAIT)
      expect(spy.mock.calls[0][0]).toMatchObject({
        camera: 'cam-lobby',
        points: [
          [100, 100],
          [500, 110],
          [520, 400],
          [130, 391],
        ],
        img_w: 1920,
        img_h: 1080,
      })
    })

    it('recomputes when dragged after a fit exists, and moves to a direct click', async () => {
      const user = userEvent.setup()
      const spy = vi.spyOn(calibrationStore, 'calibrateRect')
      renderCalibrate()
      await loadPictures()
      const svg = canvasFor('cam-lobby')
      clickAt(svg, 100, 100)
      clickAt(svg, 500, 110)
      clickAt(svg, 520, 400)
      await user.click(await screen.findByRole('button', { name: 'Compute and save' }))
      await screen.findByRole('button', { name: 'Compute again' }, WAIT)

      /* Drag the handle: pointer down on it, move, release. */
      const handle = screen.getByRole('button', { name: /Corner 4/ })
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 120, clientY: 390 })
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 420 })
      fireEvent.pointerUp(svg, { pointerId: 1, clientX: 140, clientY: 420 })
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2), WAIT)
      expect(spy.mock.calls[1][0].points[3]).toEqual([140, 420])

      /* The click that ends a drag is not a new point... */
      fireEvent.click(svg, { clientX: 140, clientY: 420 })
      /* ...but a later click is "the corner is really here". */
      clickAt(svg, 150, 430)
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(3), WAIT)
      expect(spy.mock.calls[2][0].points[3]).toEqual([150, 430])
    })
  })

  describe('shared lines', () => {
    const IDENTITY = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    function entry(camera: string, aligned: boolean): CameraCalibration {
      return { camera, Hinv: IDENTITY, diagnostics: { aligned } }
    }
    function renderAlign(aligned: boolean) {
      const cameras = [getCamera(CAMERA_ID_COUNTER), getCamera(CAMERA_ID_LOBBY)]
      const byCamera = new Map([
        ['cam-counter', entry('cam-counter', aligned)],
        ['cam-lobby', entry('cam-lobby', aligned)],
      ])
      return wrap(
        <AlignMode
          agencyId={AGENCY_ID}
          cameras={cameras}
          byCamera={byCamera}
          onAligned={() => {}}
        />,
      )
    }

    it('turns a line with matching counts into that many shared spots', async () => {
      const user = userEvent.setup()
      renderAlign(false)
      await user.click(screen.getByRole('button', { name: 'Shared lines' }))
      await loadPictures(2)

      for (const name of ['cam-counter', 'cam-lobby']) {
        const svg = canvasFor(name)
        clickAt(svg, 100, 500)
        clickAt(svg, 300, 500)
        clickAt(svg, 500, 500)
      }
      await user.click(screen.getByRole('button', { name: 'Finish this line' }))

      expect(await screen.findByText(/Line added as 3 shared spots/)).toBeInTheDocument()
      expect(screen.getByText('3 spots recorded.')).toBeInTheDocument()
      /* 3 spots tie the pair, so the solve is offered. */
      expect(screen.getByRole('button', { name: 'Align the cameras' })).toBeEnabled()
    })

    it('refuses to pair cameras that clicked different numbers of points', async () => {
      const user = userEvent.setup()
      renderAlign(false)
      await user.click(screen.getByRole('button', { name: 'Shared lines' }))
      await loadPictures(2)

      const a = canvasFor('cam-counter')
      clickAt(a, 100, 500)
      clickAt(a, 300, 500)
      const b = canvasFor('cam-lobby')
      clickAt(b, 100, 500)
      clickAt(b, 300, 500)
      clickAt(b, 500, 500)
      await user.click(screen.getByRole('button', { name: 'Finish this line' }))

      expect(await screen.findByText(/clicked different numbers of points/)).toBeInTheDocument()
      expect(screen.getByText('No spots recorded yet.')).toBeInTheDocument()
    })

    /* Pairing by click order silently mismatches a line clicked from the
       other end. Between aligned cameras that is caught, and blocks finishing
       until reversed. */
    it('catches a line clicked from the other end, and reverses it', async () => {
      const user = userEvent.setup()
      renderAlign(true)
      await user.click(screen.getByRole('button', { name: 'Shared lines' }))
      await loadPictures(2)

      const a = canvasFor('cam-counter')
      clickAt(a, 100, 500)
      clickAt(a, 500, 500)
      const b = canvasFor('cam-lobby')
      clickAt(b, 500, 500)
      clickAt(b, 100, 500)

      const warning = await screen.findByRole('alert')
      expect(
        within(warning).getByText(/cam-lobby clicked this line from the other end/),
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Finish this line' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: "Reverse cam-lobby's points" }))
      expect(screen.queryByText(/from the other end/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Finish this line' })).toBeEnabled()
    })

    it('flags a camera whose points do not fall on a straight floor line', async () => {
      const user = userEvent.setup()
      renderAlign(false)
      await user.click(screen.getByRole('button', { name: 'Shared lines' }))
      await loadPictures(2)

      const a = canvasFor('cam-counter')
      clickAt(a, 100, 500)
      clickAt(a, 300, 700)
      clickAt(a, 500, 500)

      expect(await screen.findByText(/bends \d+% off straight/)).toBeInTheDocument()
    })
  })

  /* The mock solves real (if simple) geometry, so these round trips are
     real arithmetic, not canned answers. */
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

  describe('cross-check', () => {
    it('refuses a camera that is not aligned yet', () => {
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      calibrationStore.calibrateRect({
        camera: 'cam-counter',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      expect(() =>
        calibrationStore.crossCheck({ 'cam-lobby': [200, 200], 'cam-counter': [200, 200] }),
      ).toThrowError(/not aligned yet/)
    })

    it('reports how far apart aligned cameras place the same spot', async () => {
      const user = userEvent.setup()
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      calibrationStore.calibrateRect({
        camera: 'cam-counter',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      /* cam-counter sees the room shifted 50 px right. */
      calibrationStore.alignCameras([
        { 'cam-lobby': [100, 100], 'cam-counter': [150, 100] },
        { 'cam-lobby': [400, 300], 'cam-counter': [450, 300] },
      ])
      wrap(
        <AlignMode
          agencyId={AGENCY_ID}
          cameras={[getCamera(CAMERA_ID_COUNTER), getCamera(CAMERA_ID_LOBBY)]}
          byCamera={byCameraFromStore()}
          onAligned={() => {}}
        />,
      )
      await loadPictures(2)
      clickAt(canvasFor('cam-lobby'), 250, 200)
      clickAt(canvasFor('cam-counter'), 300, 200)
      await user.click(screen.getByRole('button', { name: 'Cross-check this spot' }))

      /* The shift the alignment learned is exactly the shift clicked, so a
         consistent spot lands in the same place: 0.0 cm apart. */
      expect(await screen.findByText('0.0 cm apart', {}, WAIT)).toBeInTheDocument()
    })
  })

  describe('gates', () => {
    function renderGates() {
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      return wrap(
        <GatesMode
          agencyId={AGENCY_ID}
          cameras={[getCamera(CAMERA_ID_LOBBY)]}
          byCamera={byCameraFromStore()}
        />,
      )
    }

    it('adds a gate without moving the ones already saved', async () => {
      const user = userEvent.setup()
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      calibrationStore.saveGates({ gates: [{ camera: 'cam-lobby', points: [[300, 300]] }] })
      const before = calibrationStore.getGates().gates[0]
      renderGates()

      expect(await screen.findByText('gate 1', { selector: 'span' }, WAIT)).toBeInTheDocument()
      await loadPictures()
      clickAt(canvasFor('cam-lobby'), 450, 420)
      await user.click(screen.getByRole('button', { name: 'Save 1 gate' }))

      await waitFor(() => expect(calibrationStore.getGates().gates).toHaveLength(2), WAIT)
      const [kept] = calibrationStore.getGates().gates
      expect(kept[0]).toBeCloseTo(before[0], 6)
      expect(kept[1]).toBeCloseTo(before[1], 6)
    })

    it('removes one gate and keeps the rest', async () => {
      const user = userEvent.setup()
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      calibrationStore.saveGates({
        gates: [
          {
            camera: 'cam-lobby',
            points: [
              [300, 300],
              [450, 420],
            ],
          },
        ],
      })
      const second = calibrationStore.getGates().gates[1]
      renderGates()

      await user.click(await screen.findByRole('button', { name: 'Remove gate 1' }, WAIT))
      await waitFor(() => expect(calibrationStore.getGates().gates).toHaveLength(1), WAIT)
      expect(calibrationStore.getGates().gates[0][0]).toBeCloseTo(second[0], 6)
    })

    /* Gates are site-wide; clearing is everyone's, so it asks first. */
    it('asks before clearing every gate on the site', async () => {
      const user = userEvent.setup()
      calibrationStore.calibrateRect({
        camera: 'cam-lobby',
        points: SQUARE,
        img_w: 1920,
        img_h: 1080,
      })
      calibrationStore.saveGates({ gates: [{ camera: 'cam-lobby', points: [[300, 300]] }] })
      renderGates()

      await user.click(
        await screen.findByRole('button', { name: /Clear every gate on the site/ }, WAIT),
      )
      expect(screen.getByText(/other branches' included/)).toBeInTheDocument()
      expect(calibrationStore.getGates().gates).toHaveLength(1)

      await user.click(screen.getByRole('button', { name: 'Clear every gate' }))
      await waitFor(() => expect(calibrationStore.getGates().gates).toHaveLength(0), WAIT)
    })
  })
})
