import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { ScopeProvider } from '@/agency/scope'
import { ThemeProvider } from '@/theme/theme'
import { mockUserForRole } from '@/mocks/currentUser'
import type { Role } from '@/api/types'

/**
 * Navigation and the URL guard, which are the same rule seen from two sides.
 *
 * A screen a role cannot use is not offered to it (2026-08-20). Hiding the link
 * alone would be half a boundary - the URL still worked - so AppShell closes
 * both, and both are tested here together for that reason.
 */
function renderShell(role: Role, initialPath = '/presence') {
  const session: SessionValue = {
    status: 'authenticated',
    user: mockUserForRole(role),
    signIn: async () => {},
    signOut: () => {},
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionContext value={session}>
          <ScopeProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route element={<AppShell />}>
                  {/* Stand-ins for the real screens: this is about which routes
                    resolve for which role, not what any of them render. */}
                  <Route path="presence" element={<p>presence screen</p>} />
                  <Route path="employees" element={<p>employees screen</p>} />
                  <Route path="agencies" element={<p>agencies screen</p>} />
                  <Route path="users" element={<p>users screen</p>} />
                  <Route path="visitors" element={<p>visitors screen</p>} />
                  <Route path="alerts" element={<p>alerts screen</p>} />
                  <Route path="controls" element={<p>controls screen</p>} />
                  <Route path="climate" element={<p>climate screen</p>} />
                  {/* TECHNICIAN's landing page (auth/landing.ts) - required so the
                      default-path redirect below has somewhere to land. */}
                  <Route path="devices" element={<p>devices screen</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ScopeProvider>
        </SessionContext>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const navLink = (name: RegExp) => screen.queryByRole('link', { name })

describe('AppShell navigation', () => {
  it('offers an admin everything', () => {
    renderShell('ADMIN')
    expect(navLink(/user accounts/i)).toBeInTheDocument()
    expect(navLink(/^agencies$/i)).toBeInTheDocument()
    expect(navLink(/employee presence/i)).toBeInTheDocument()
  })

  /* The report that started this: a manager was shown User accounts and got a
     refusal when they clicked it. The link is simply not there now. */
  it('does not offer user accounts to a manager', () => {
    renderShell('MANAGER')
    expect(navLink(/user accounts/i)).not.toBeInTheDocument()
  })

  /* The manager keeps the list. Theirs is a single card - the backend filters
     it to their own branch - and since the per-branch page was removed it is
     the only place their hours, counters and zones appear (2026-09-09). */
  it('offers the agencies list to a manager', () => {
    renderShell('MANAGER')
    expect(navLink(/^agencies$/i)).toBeInTheDocument()
  })

  it('does not offer employees, agencies or climate to an agent', () => {
    renderShell('AGENT')
    expect(navLink(/employees/i)).not.toBeInTheDocument()
    expect(navLink(/^agencies$/i)).not.toBeInTheDocument()
    expect(navLink(/climate/i)).not.toBeInTheDocument()
    expect(navLink(/visitor queue/i)).toBeInTheDocument()
  })

  /* A guard gets two screens and nothing else (2026-09-09). Asserted as the
     whole list rather than as absences, so a screen added to SCREENS later
     cannot quietly appear in their sidebar - the skip link sits outside the
     nav, so this is every link they are offered. */
  it('offers security only alerts and manual controls', () => {
    renderShell('SECURITY')
    const links = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Alerts', 'Manual controls'])
  })

  it('leaves the unguarded screens for every role', () => {
    renderShell('TECHNICIAN')
    expect(navLink(/manual controls/i)).toBeInTheDocument()
    expect(navLink(/alerts/i)).toBeInTheDocument()
  })

  /* Services and climate are both built on reads the API gives only an admin
     or a manager, so the three roles below them are offered neither - the nav
     would have been pointing at a refusal message (2026-09-09). */
  it('offers services and climate to nobody below a manager', () => {
    for (const role of ['AGENT', 'SECURITY', 'TECHNICIAN'] as const) {
      const { unmount } = renderShell(role)
      expect(navLink(/^services$/i)).not.toBeInTheDocument()
      expect(navLink(/climate/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('keeps both for a manager', () => {
    renderShell('MANAGER')
    expect(navLink(/^services$/i)).toBeInTheDocument()
    expect(navLink(/climate/i)).toBeInTheDocument()
  })
})

describe('AppShell URL guard', () => {
  it('redirects a manager who types the users URL to their own start screen', () => {
    renderShell('MANAGER', '/users')

    expect(screen.queryByText('users screen')).not.toBeInTheDocument()
    /* A manager starts on presence, so that is where they land. */
    expect(screen.getByText('presence screen')).toBeInTheDocument()
  })

  it('redirects an agent away from employees', () => {
    renderShell('AGENT', '/employees')

    expect(screen.queryByText('employees screen')).not.toBeInTheDocument()
    expect(screen.getByText('visitors screen')).toBeInTheDocument()
  })

  it('redirects an agent away from climate', () => {
    renderShell('AGENT', '/climate')

    expect(screen.queryByText('climate screen')).not.toBeInTheDocument()
    expect(screen.getByText('visitors screen')).toBeInTheDocument()
  })

  /* The URL half of the same rule for the other two, each landing on its own
     start screen rather than on a shared default. */
  it('redirects security away from presence to their own alerts', () => {
    renderShell('SECURITY', '/presence')

    expect(screen.queryByText('presence screen')).not.toBeInTheDocument()
    expect(screen.getByText('alerts screen')).toBeInTheDocument()
  })

  it('redirects security and a technician away from climate', () => {
    const { unmount } = renderShell('SECURITY', '/climate')
    expect(screen.queryByText('climate screen')).not.toBeInTheDocument()
    expect(screen.getByText('alerts screen')).toBeInTheDocument()
    unmount()

    renderShell('TECHNICIAN', '/climate')
    expect(screen.queryByText('climate screen')).not.toBeInTheDocument()
    expect(screen.getByText('devices screen')).toBeInTheDocument()
  })

  it('lets an allowed URL through untouched', () => {
    renderShell('ADMIN', '/users')
    expect(screen.getByText('users screen')).toBeInTheDocument()
  })
})
