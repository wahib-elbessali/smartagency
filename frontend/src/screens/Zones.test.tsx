import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Zones from './Zones'
import { createZone as postZone } from '@/api/endpoints/zones'
import { clearSession, setSession } from '@/api/tokenStore'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { ScopeProvider } from '@/agency/scope'
import type { Role } from '@/api/types'
import { mockUserForRole } from '@/mocks/currentUser'
import { resetCameraStore } from '@/mocks/cameraStore'
import { AGENCY_ID, AGENCY_ID_RABAT } from '@/mocks/fixtures/people'
import * as zoneStore from '@/mocks/zoneStore'
import '@/mocks'

/**
 * THE SESSION IS SET IN BOTH PLACES ON PURPOSE.
 *
 * SessionContext is what the screen branches on; tokenStore is what the
 * fixtures scope by (mocks/currentUser.ts reads the session behind the
 * bearer token, exactly as the backend would). Supplying only the context
 * would leave the fixture layer answering as an unscoped ADMIN, and a
 * manager would appear to receive zones from branches they cannot see -
 * the same trap Users.test.tsx documents.
 *
 * Two things about jsdom shape what can be asserted here, and both are about
 * the canvas rather than the screen: an <img> never loads, so `onLoad` never
 * fires and the SVG overlay is never mounted; and `getScreenCTM` does not
 * exist at all. So clicking a polygon into being is not testable here. What
 * is tested is everything the drawing produces and everything around it -
 * scoping, the per-camera split, delete, and the store's own rules. The
 * click-to-coordinate mapping was verified in Chrome instead.
 *
 * The gateway returns the WHOLE site's zones to anyone who may read the
 * agency (backend/app/api/ai_zoning.py), and the fixture does the same - so
 * every "not shown" below is the screen's filter at work, not the mock's.
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
            <Zones />
          </MemoryRouter>
        </ScopeProvider>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

describe('Zones', () => {
  beforeEach(() => {
    resetZoneAndCameras()
  })
  afterEach(clearSession)

  function resetZoneAndCameras() {
    zoneStore.resetZoneStore()
    resetCameraStore()
  }

  it('shows the zones drawn on the selected camera, and counts the rest', async () => {
    renderAs('MANAGER')

    /* cam-counter sorts before cam-lobby, so it is the camera in hand. */
    expect(await screen.findByRole('heading', { name: 'cam-counter' }, WAIT)).toBeInTheDocument()
    expect(await screen.findByText('counters', {}, WAIT)).toBeInTheDocument()

    /* lobby and the world zone hall are on this branch's other camera.
       vault is in Rabat: the gateway sends it anyway, the screen drops it,
       and it is not in the count either. */
    expect(screen.getByText(/2 more on other cameras/)).toBeInTheDocument()
    expect(screen.queryByText('vault')).not.toBeInTheDocument()
  })

  it('follows the camera picker', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    await screen.findByText('counters', {}, WAIT)

    const picker = await screen.findByLabelText('Camera', {}, WAIT)
    await user.selectOptions(picker, within(picker).getByRole('option', { name: 'cam-lobby' }))

    expect(await screen.findByText('lobby', {}, WAIT)).toBeInTheDocument()
    expect(screen.queryByText('counters')).not.toBeInTheDocument()
    /* A world zone made elsewhere still shows on the camera it was drawn
       on, read as what it is. */
    expect(screen.getByText('hall')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('counts only the picked branch’s zones for an admin too', async () => {
    renderAs('ADMIN')
    /* An admin starts in Casablanca. Rabat's vault is in the payload but on
       none of these cameras, so it is neither listed nor counted. */
    expect(await screen.findByText('counters', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText(/2 more on other cameras/)).toBeInTheDocument()
    expect(screen.queryByText('vault')).not.toBeInTheDocument()
  })

  it('deletes a zone', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    await screen.findByText('counters', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Delete counters' }))

    await waitFor(() => expect(screen.queryByText('counters')).not.toBeInTheDocument(), WAIT)
    expect('counters' in zoneStore.listZones()).toBe(false)
  })
})

/**
 * The gateway's refusals, asserted at the layer that owns them. The screen
 * cannot build most of these requests - its pickers only offer the caller's
 * own branch and cameras - but the gateway refuses them anyway.
 */
describe('zone gateway', () => {
  beforeEach(() => {
    zoneStore.resetZoneStore()
    resetCameraStore()
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })
  })
  afterEach(clearSession)

  const TRIANGLE: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
  ]

  it('refuses another branch outright', async () => {
    await expect(
      postZone(AGENCY_ID_RABAT, {
        name: 'vault-2',
        camera: 'cam-store',
        polygon: TRIANGLE,
        sources: { 'cam-store': 'rtsp://x' },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('refuses another branch’s camera under your own branch', async () => {
    await expect(
      postZone(AGENCY_ID, {
        name: 'vault-2',
        camera: 'cam-store',
        polygon: TRIANGLE,
        sources: { 'cam-store': 'rtsp://x' },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a drawn-on camera missing from sources', async () => {
    await expect(
      postZone(AGENCY_ID, {
        name: 'odd',
        camera: 'cam-lobby',
        polygon: TRIANGLE,
        sources: { 'cam-counter': 'rtsp://x' },
      }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('saves a pixel zone with the database’s stream url, not the one sent', async () => {
    const saved = await postZone(AGENCY_ID, {
      name: 'queue',
      camera: 'cam-lobby',
      polygon: TRIANGLE,
      sources: { 'cam-lobby': 'rtsp://anything' },
    })
    expect(saved).toMatchObject({ name: 'queue', mode: 'pixel', warnings: [] })
    expect(zoneStore.listZones().queue?.camera).toBe('cam-lobby')
  })
})

/**
 * The store's rules are the AI service's rules: three points minimum, and a
 * repeated name replaces rather than collides.
 */
describe('zoneStore', () => {
  beforeEach(zoneStore.resetZoneStore)

  it('refuses fewer than three points', () => {
    expect(() =>
      zoneStore.createZone({
        name: 'sliver',
        camera: 'cam-counter',
        polygon: [
          [0, 0],
          [5, 5],
        ],
        sources: { 'cam-counter': 'rtsp://x' },
      }),
    ).toThrowError(/3 points/)
  })

  it('replaces a zone whose name already exists rather than adding a second', () => {
    const before = Object.keys(zoneStore.listZones()).length

    zoneStore.createZone({
      name: 'lobby',
      camera: 'cam-counter',
      polygon: [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      sources: { 'cam-counter': 'rtsp://x' },
    })

    const after = zoneStore.listZones()
    expect(Object.keys(after)).toHaveLength(before)
    const lobby = after.lobby
    expect(lobby?.polygon_px).toHaveLength(3)
    /* Including the camera: replacing moves the zone to wherever it was
       just drawn, which is the behaviour that makes the warning in the
       naming dialog worth showing. */
    expect(lobby?.camera).toBe('cam-counter')
  })
})
