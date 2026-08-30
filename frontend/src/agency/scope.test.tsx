import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ScopeProvider } from './scope'
import { useScope, withinScope } from './ScopeContext'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { mockUserForRole } from '@/mocks/currentUser'
import { AGENCY_ID, AGENCY_ID_RABAT } from '@/mocks/fixtures/people'
import type { Role } from '@/api/types'

/**
 * The branch an admin is working inside.
 *
 * A view filter, not a permission - which is what most of these tests are
 * really about. It must do nothing for the roles whose data the backend already
 * scopes, it must do nothing until somebody asks for it, and it must let go the
 * moment the session changes underneath it.
 */
function Probe() {
  const scope = useScope()
  return (
    <div>
      <span data-testid="scope">{scope.agencyId ?? 'none'}</span>
      <span data-testid="name">{scope.agencyName ?? 'none'}</span>
      <button onClick={() => scope.enter({ id: AGENCY_ID, name: 'Agence Casablanca' })}>
        enter
      </button>
      <button onClick={scope.leave}>leave</button>
    </div>
  )
}

function renderAs(role: Role) {
  const session: SessionValue = {
    status: 'authenticated',
    user: mockUserForRole(role),
    signIn: async () => {},
    signOut: () => {},
  }
  return render(
    <SessionContext value={session}>
      <ScopeProvider>
        <Probe />
      </ScopeProvider>
    </SessionContext>,
  )
}

describe('ScopeProvider', () => {
  it('starts with nothing scoped', () => {
    renderAs('ADMIN')
    expect(screen.getByTestId('scope')).toHaveTextContent('none')
  })

  it('holds the branch an admin enters, and lets it go again', async () => {
    const user = userEvent.setup()
    renderAs('ADMIN')

    await user.click(screen.getByRole('button', { name: 'enter' }))
    expect(screen.getByTestId('scope')).toHaveTextContent(AGENCY_ID)
    expect(screen.getByTestId('name')).toHaveTextContent('Agence Casablanca')

    await user.click(screen.getByRole('button', { name: 'leave' }))
    expect(screen.getByTestId('scope')).toHaveTextContent('none')
  })

  /**
   * The rule that keeps this a lens rather than a boundary.
   *
   * A MANAGER's rows arrive already filtered by the backend. Filtering them
   * again here would be the frontend enforcing someone else's boundary, and if
   * the held branch were ever not theirs it would quietly show them nothing.
   */
  it('does nothing for a manager, even if a branch is held', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')

    await user.click(screen.getByRole('button', { name: 'enter' }))

    expect(screen.getByTestId('scope')).toHaveTextContent('none')
    expect(screen.getByTestId('name')).toHaveTextContent('none')
  })

  it('answers for a tree with no session at all', () => {
    render(
      <ScopeProvider>
        <Probe />
      </ScopeProvider>,
    )
    expect(screen.getByTestId('scope')).toHaveTextContent('none')
  })
})

describe('withinScope', () => {
  const rows = [
    { id: 'a', agency_id: AGENCY_ID },
    { id: 'b', agency_id: AGENCY_ID_RABAT },
    { id: 'c', agency_id: AGENCY_ID },
  ]

  /* It must, or an admin who never opened a branch would see nothing at all. */
  it('returns everything when no branch is open', () => {
    expect(withinScope(rows, null)).toHaveLength(3)
  })

  it('keeps only the branch that is open', () => {
    expect(withinScope(rows, AGENCY_ID).map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('returns nothing for a branch with no rows, rather than everything', () => {
    expect(withinScope(rows, 'a-branch-with-nobody-in-it')).toEqual([])
  })
})
