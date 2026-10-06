import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ClientStats from './ClientStats'
import { clearSession, setSession } from '@/api/tokenStore'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { ScopeProvider } from '@/agency/scope'
import type { Role } from '@/api/types'
import { mockUserForRole } from '@/mocks/currentUser'
import { ticketHistory } from '@/mocks/ticketHistory'
import { resetTicketStore } from '@/mocks/ticketStore'
import '@/mocks'

/** Session in both places - the screen reads the context, fixtures read tokenStore. */
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
            <ClientStats />
          </MemoryRouter>
        </ScopeProvider>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

describe('ClientStats', () => {
  beforeEach(resetTicketStore)
  afterEach(clearSession)

  it('shows how many came and how many were served this week', async () => {
    renderAs('ADMIN')
    await userEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }, WAIT))

    await screen.findByRole('heading', { name: 'Came and served, by day' }, WAIT)

    /* The tile must agree with the fixture, counted independently. */
    const week = ticketHistory()
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - 6)
    const inWeek = week.filter((t) => new Date(t.created_at) >= from)
    const came = screen.getByText('Clients who came').parentElement!
    expect(within(came).getByText(String(inWeek.length))).toBeInTheDocument()

    /* Not compared exactly: a ticket can finish between the render and this
       line, since "now" moves. Arrivals cannot un-arrive, so `came` can be. */
    const tile = screen.getByText(/of finished visits/).closest('.rounded-panel') as HTMLElement
    const served = Number(within(tile).getByText(/^\d+$/).textContent)
    expect(served).toBeGreaterThan(0)
    expect(served).toBeLessThanOrEqual(inWeek.length)

    expect(screen.getByRole('table', { name: /clients per service/i })).toBeInTheDocument()
  })

  it('keeps another branch out of a manager’s numbers', async () => {
    renderAs('MANAGER')
    await userEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }, WAIT))
    const table = await screen.findByRole('table', { name: /clients per service/i }, WAIT)
    /* Rabat's tickets are all the free-text "Opérations courantes". */
    expect(within(table).queryByText('Opérations courantes')).not.toBeInTheDocument()
    expect(within(table).getByText('Virement et consultation')).toBeInTheDocument()
  })

  it('tells security staff who can see it rather than failing', async () => {
    renderAs('SECURITY')
    expect(
      await screen.findByText(/visible to administrators, managers and agents/i, {}, WAIT),
    ).toBeInTheDocument()
  })
})
