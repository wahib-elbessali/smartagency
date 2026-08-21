import { render, screen } from '@testing-library/react'
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
    expect(navLink(/agencies/i)).toBeInTheDocument()
    expect(navLink(/employee presence/i)).toBeInTheDocument()
  })

  /* The report that started this: a manager was shown User accounts and got a
     refusal when they clicked it. The link is simply not there now. */
  it('does not offer user accounts to a manager', () => {
    renderShell('MANAGER')
    expect(navLink(/user accounts/i)).not.toBeInTheDocument()
    expect(navLink(/agencies/i)).toBeInTheDocument()
  })

  it('does not offer employees or agencies to an agent', () => {
    renderShell('AGENT')
    expect(navLink(/employees/i)).not.toBeInTheDocument()
    expect(navLink(/agencies/i)).not.toBeInTheDocument()
    expect(navLink(/visitor queue/i)).toBeInTheDocument()
  })

  /* Security reads the roster but administers nobody on it. */
  it('offers presence to security but not employees', () => {
    renderShell('SECURITY')
    expect(navLink(/employee presence/i)).toBeInTheDocument()
    expect(navLink(/employees/i)).not.toBeInTheDocument()
  })

  it('leaves the unguarded screens for every role', () => {
    renderShell('TECHNICIAN')
    expect(navLink(/manual controls/i)).toBeInTheDocument()
    expect(navLink(/alerts/i)).toBeInTheDocument()
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

  it('lets an allowed URL through untouched', () => {
    renderShell('ADMIN', '/users')
    expect(screen.getByText('users screen')).toBeInTheDocument()
  })
})
