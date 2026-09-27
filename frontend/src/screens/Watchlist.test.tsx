import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Watchlist from './Watchlist'
import { clearSession, setSession } from '@/api/tokenStore'
import type { Role } from '@/api/types'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { mockUserForRole } from '@/mocks/currentUser'
import * as wantedStore from '@/mocks/wantedStore'
import '@/mocks'

/* Session in both places, for the reason Zones.test.tsx gives. */
function renderAs(role: Role) {
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
        <MemoryRouter>
          <Watchlist />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }
const photo = () => new File(['face'], 'face.jpg', { type: 'image/jpeg' })

describe('Watchlist', () => {
  beforeEach(() => {
    wantedStore.resetWantedStore()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('lists who is on it, by name and photo count, never a photo', async () => {
    renderAs('MANAGER')
    expect(await screen.findByText('MAROUANE-B-2024-114', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText(/2 photos · added/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('adds a person with one photo', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    await user.click(await screen.findByRole('button', { name: /add person/i }, WAIT))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText(/name or reference/i), 'CASE-2026-77')
    await user.upload(within(dialog).getByLabelText(/^photo/i), photo())
    await user.click(within(dialog).getByRole('button', { name: 'Add to watchlist' }))

    expect(await screen.findByText('CASE-2026-77', {}, WAIT)).toBeInTheDocument()
    expect(wantedStore.listWatchlist(null).map((p) => p.name)).toContain('CASE-2026-77')
  })

  /* The gateway refuses a name already listed; the form says so first. */
  it('refuses a name that is already on the list, and a name it cannot take', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    /* The list has to be known before a clash can be seen. */
    await screen.findByText('MAROUANE-B-2024-114', {}, WAIT)
    await user.click(await screen.findByRole('button', { name: /add person/i }, WAIT))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText(/name or reference/i)

    await user.type(name, 'MAROUANE-B-2024-114')
    expect(within(dialog).getByText(/Already on the list/)).toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Café/1')
    expect(within(dialog).getByText(/Letters, digits, spaces/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add to watchlist' })).toBeDisabled()
  })

  it('removes a person after saying every photo goes with them', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    await user.click(
      await screen.findByRole('button', { name: 'Remove MAROUANE-B-2024-114' }, WAIT),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/no removing just one photo/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(wantedStore.listWatchlist(null)).toHaveLength(0), WAIT)
  })

  /* SECURITY acts on hits and may read the list; changing it is not theirs. */
  it('lets security read but not change anything', async () => {
    renderAs('SECURITY')
    await screen.findByText('MAROUANE-B-2024-114', {}, WAIT)
    expect(screen.queryByRole('button', { name: /add person/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
    expect(await screen.findByLabelText(/match threshold/i)).toBeDisabled()
  })

  it('shows the warning for a threshold below the default', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    const field = await screen.findByLabelText(/match threshold/i)
    await waitFor(() => expect(field).toHaveValue(0.5), WAIT)

    await user.clear(field)
    await user.type(field, '0.4')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/raising the false-accusation rate/, {}, WAIT),
    ).toBeInTheDocument()
    await waitFor(() => expect(field).toHaveValue(0.4), WAIT)
  })

  it('stops a threshold below the floor before sending it', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    const field = await screen.findByLabelText(/match threshold/i)
    await waitFor(() => expect(field).toHaveValue(0.5), WAIT)

    await user.clear(field)
    await user.type(field, '0.2')
    expect(screen.getByText('Between 0.25 and 1.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
