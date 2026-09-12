import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Climate from './Climate'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { ScopeContext, type ScopeValue } from '@/agency/ScopeContext'
import type { Role } from '@/api/types'
import { clearSession, setSession } from '@/api/tokenStore'
import { mockUserForRole } from '@/mocks/currentUser'
import { AGENCY_ID_RABAT } from '@/mocks/fixtures/people'
import { DEVICE_ID_DHT22, resetDeviceStore } from '@/mocks/deviceStore'
import { resetReadingStore } from '@/mocks/readingStore'
import { deleteThreshold, resetThresholdStore, upsertThreshold } from '@/mocks/thresholdStore'
import '@/mocks'

/**
 * The inside half of the screen. The outside half talks to Open-Meteo, which
 * a test must not - so the weather module is replaced with one answer, and
 * nothing here asserts on it beyond "it rendered".
 */
vi.mock('@/api/weather', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/weather')>()
  return {
    ...actual,
    fetchCityWeather: vi.fn().mockResolvedValue({
      resolvedName: 'Casablanca',
      temperatureC: 22,
      feelsLikeC: 21,
      humidityPct: 70,
      windKph: 12,
      windGustKph: null,
      precipitationMm: 0,
      cloudCoverPct: 40,
      pressureHpa: 1015,
      code: 1,
    }),
  }
})

function renderAs(role: Role, scopedAgency: { id: string; name: string } | null = null) {
  const user = mockUserForRole(role)
  /* Both, as Users.test.tsx explains: the context is what the screen reads,
     the token store is what the fixtures scope by. Without the second a
     manager's agency list comes back unscoped - two branches, no focus, and
     no Inside section to test. */
  setSession({ accessToken: 'FIXTURE.ACCESS', refreshToken: 'FIXTURE.REFRESH', user })
  const session: SessionValue = {
    status: 'authenticated',
    user,
    signIn: async () => {},
    signOut: () => {},
  }
  /* Supplied directly rather than through ScopeProvider, so an admin test can
     start already inside a branch instead of clicking Open on the Agencies
     screen first. */
  const scope: ScopeValue = {
    agencyId: scopedAgency?.id ?? null,
    agencyName: scopedAgency?.name ?? null,
    enter: () => {},
    leave: () => {},
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={session}>
        <ScopeContext value={scope}>
          <MemoryRouter>
            <Climate />
          </MemoryRouter>
        </ScopeContext>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

const inside = async () => within(await screen.findByRole('region', { name: 'Inside' }, WAIT))

describe('Climate - inside', () => {
  beforeEach(() => {
    clearSession()
    resetDeviceStore()
    resetReadingStore()
    resetThresholdStore()
  })

  it("shows the branch's latest indoor readings beside the weather", async () => {
    renderAs('MANAGER')
    const section = await inside()
    expect(await section.findByText('Temperature', {}, WAIT)).toBeInTheDocument()
    expect(section.getByText('Humidity')).toBeInTheDocument()
    /* Seeded under the 30°C warning line, so the tile names the line it is
       under rather than staying silent about it. */
    expect(
      await section.findByText(/under the warning level of 30°C/i, {}, WAIT),
    ).toBeInTheDocument()
    expect(section.getAllByText(/Capteur DHT22/)).toHaveLength(2)
  })

  /* The line is the threshold table's, not the screen's: move it below the
     reading and the same number becomes a warning. */
  it('turns a reading into a warning when it crosses its device threshold', async () => {
    upsertThreshold(DEVICE_ID_DHT22, 'temperature', {
      unit: 'C',
      warning_max: 10,
      critical_max: 15,
    })
    renderAs('MANAGER')
    const section = await inside()
    expect(
      await section.findByText(/above the critical level of 15°C/i, {}, WAIT),
    ).toBeInTheDocument()
  })

  it('says when no threshold has been set rather than judging', async () => {
    /* Humidity loses its seeded threshold, so it is the tile with no line to
       compare against; temperature keeps its own and still names it. */
    deleteThreshold(DEVICE_ID_DHT22, 'humidity')
    renderAs('MANAGER')
    const section = await inside()
    expect(
      await section.findByText(/no threshold set for this sensor/i, {}, WAIT),
    ).toBeInTheDocument()
  })

  /* Rabat's DHT22 is seeded in ERROR and last heard from six hours ago; its
     readings stop there. An admin looking at Rabat should be told the sensor
     is not well, not handed a stale number as if it were live. */
  it('flags a reading from a sensor that is not online', async () => {
    renderAs('ADMIN', { id: AGENCY_ID_RABAT, name: 'Agence Rabat' })
    const section = await inside()
    await section.findByText('Temperature', {}, WAIT)
    expect(section.getAllByText(/sensor error/i).length).toBeGreaterThan(0)
  })
})
