import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Zones from './Zones'
import PeopleMap from './PeopleMap'
import { clearSession, setSession } from '@/api/tokenStore'
import type { Role } from '@/api/types'
import { ScopeProvider } from '@/agency/scope'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { mockUserForRole } from '@/mocks/currentUser'
import { resetCameraStore } from '@/mocks/cameraStore'
import * as calibrationStore from '@/mocks/calibrationStore'
import * as peopleStore from '@/mocks/peopleStore'
import * as zoneStore from '@/mocks/zoneStore'
import '@/mocks'
import { canvasFor, clickAt, loadPictures, stubSvgGeometry } from '@/test/canvas'

/**
 * Floor ("world") zones on the Zones screen, and the live floor map - the two
 * screens person tracking feeds. The tracker in fixture mode is the scripted
 * replay in mocks/peopleStore.ts, so these drive it directly: reset it to
 * start from idle, or jump it straight to running.
 */
function renderAs(role: Role, node: React.ReactNode) {
  const user = mockUserForRole(role)
  setSession({ accessToken: 'mock-token', refreshToken: 'mock-refresh', user })
  const session: SessionValue = {
    status: 'authenticated',
    user,
    signIn: async () => {},
    signOut: () => {},
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext value={session}>
        <ScopeProvider>
          <MemoryRouter>{node}</MemoryRouter>
        </ScopeProvider>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }
const SQUARE: Array<[number, number]> = [
  [100, 100],
  [500, 100],
  [500, 500],
  [100, 500],
]

function alignBothCasablancaCameras() {
  for (const camera of ['cam-lobby', 'cam-counter']) {
    calibrationStore.calibrateRect({ camera, points: SQUARE, img_w: 1920, img_h: 1080 })
  }
  calibrationStore.alignCameras([
    { 'cam-counter': [100, 100], 'cam-lobby': [150, 100] },
    { 'cam-counter': [400, 300], 'cam-lobby': [450, 300] },
  ])
}

describe('floor zones', () => {
  beforeEach(() => {
    resetCameraStore()
    zoneStore.resetZoneStore()
    calibrationStore.resetCalibrationStore()
    peopleStore.resetPeopleStore()
    stubSvgGeometry()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('offers nothing to draw on until two cameras are aligned', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER', <Zones />)
    await screen.findByText('counters', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Several cameras (floor)' }))
    expect(
      await screen.findByText(/needs at least two cameras that are calibrated and aligned/),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Draw on')).not.toBeInTheDocument()
  })

  it('waits for person tracking before letting a floor zone be closed', async () => {
    const user = userEvent.setup()
    alignBothCasablancaCameras()
    renderAs('MANAGER', <Zones />)
    await screen.findByText('counters', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Several cameras (floor)' }))
    await user.click(await screen.findByLabelText('cam-lobby', {}, WAIT))
    expect(await screen.findByText(/Person tracking is idle/, {}, WAIT)).toBeInTheDocument()

    await loadPictures()
    const svg = canvasFor('cam-counter')
    clickAt(svg, 100, 100)
    clickAt(svg, 400, 100)
    clickAt(svg, 400, 400)
    expect(screen.getByRole('button', { name: 'Close zone' })).toBeDisabled()
  })

  it('saves a floor zone across the ticked cameras once tracking runs', async () => {
    const user = userEvent.setup()
    alignBothCasablancaCameras()
    peopleStore.startPeopleRunning()
    renderAs('MANAGER', <Zones />)
    await screen.findByText('counters', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Several cameras (floor)' }))
    await user.click(await screen.findByLabelText('cam-lobby', {}, WAIT))
    expect(await screen.findByText(/Person tracking is running/, {}, WAIT)).toBeInTheDocument()

    await loadPictures()
    const svg = canvasFor('cam-counter')
    clickAt(svg, 100, 100)
    clickAt(svg, 400, 100)
    clickAt(svg, 400, 400)
    await user.click(screen.getByRole('button', { name: 'Close zone' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^name/i), 'floor-1')
    await user.click(within(dialog).getByRole('button', { name: 'Save zone' }))

    await waitFor(() => expect(zoneStore.listZones()['floor-1']).toBeDefined(), WAIT)
    const saved = zoneStore.listZones()['floor-1']
    expect(saved.mode).toBe('world')
    expect(saved.converted_from?.camera).toBe('cam-counter')
    expect(saved.polygon_m).toHaveLength(3)
  })
})

describe('live floor map', () => {
  beforeEach(() => {
    resetCameraStore()
    zoneStore.resetZoneStore()
    peopleStore.resetPeopleStore()
  })
  afterEach(clearSession)

  /* The phases in order, and nobody on the map until it runs. */
  it('goes from not tracking to tracking, then plots and lists people', async () => {
    renderAs('SECURITY', <PeopleMap />)

    expect(await screen.findByText('Not tracking', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('No tracks until the tracker is running.')).toBeInTheDocument()

    expect(await screen.findByText('Tracking', {}, WAIT)).toBeInTheDocument()
    const table = await screen.findByRole('table', {}, WAIT)
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(2), WAIT)
    expect(screen.getByRole('img', { name: /Floor map with \d+ tracked/ })).toBeInTheDocument()
  })

  /* A floor zone on this branch's camera is drawn under the dots. */
  it('draws the branch’s floor zones on the map', async () => {
    peopleStore.startPeopleRunning()
    renderAs('MANAGER', <PeopleMap />)
    const map = await screen.findByRole('img', { name: /Floor map/ }, WAIT)
    await waitFor(() => expect(within(map).getByText('hall')).toBeInTheDocument(), WAIT)
  })
})
