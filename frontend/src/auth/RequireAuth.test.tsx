import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RequireAuth } from './RequireAuth'
import { SessionProvider } from './session'

function renderGuarded() {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route
            path="/secret"
            element={
              <RequireAuth>
                <p>protected content</p>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<p>login screen</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
}

describe('RequireAuth', () => {
  /* VITE_AUTH_ENFORCED is unset in tests, which is the current shipping state:
     the guard is wired but inert, because there is no sign-in endpoint yet. If
     someone flips the default on before that exists, this fails and says why. */
  it('lets traffic through while enforcement is off', () => {
    renderGuarded()
    expect(screen.getByText('protected content')).toBeInTheDocument()
    expect(screen.queryByText('login screen')).not.toBeInTheDocument()
  })
})
