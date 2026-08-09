import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import Users from './Users'
import { SessionProvider } from '@/auth/session'
import { useSession } from '@/auth/SessionContext'
import { resetUserStore } from '@/mocks/userStore'
import { resetEmployeeStore } from '@/mocks/employeeStore'
import '@/mocks'

/* Signs in through the real provider rather than stubbing a user, because the
   "(you)" marker and the disabled delete both key off the session's id. */
function SignIn({ children }: { children: React.ReactNode }) {
  const { status, signIn } = useSession()
  if (status !== 'authenticated') {
    void signIn({ email: 'admin@agency.com', password: 'password123' })
    return null
  }
  return <>{children}</>
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter>
          <SignIn>
            <Users />
          </SignIn>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const TABLE_WAIT = { timeout: 4000 }

describe('Users', () => {
  beforeEach(() => {
    resetUserStore()
    resetEmployeeStore()
  })

  it('lists the accounts', async () => {
    renderScreen()
    expect(await screen.findByRole('table', {}, TABLE_WAIT)).toBeInTheDocument()
    /* Twice over: once as the account, once as the employee it is linked to.
       That duplication is the point - the two columns describe the same
       person from different sides. */
    expect(screen.getAllByText('Fatima Abbar').length).toBe(2)
  })

  /* An account with no employee is legal - a login need not be a person with a
     card - and a blank cell would read as missing data rather than as a fact. */
  it('says when an account has no linked employee', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)
    expect(screen.getAllByText('Not linked').length).toBeGreaterThan(0)
  })

  /* The rule is inverted from the intuitive one, so the form must not offer an
     agency for an ADMIN at all: sending one is a 422. */
  it('hides the agency picker when the new account is an admin, and explains why', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/^agency/i)).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText(/^role/i), 'ADMIN')

    expect(within(dialog).queryByLabelText(/^agency/i)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/an admin is global and has no agency/i)).toBeInTheDocument()
  })

  /* Every non-admin role needs one (422 without), so it is required here. */
  it('requires an agency for a non-admin account', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    await user.type(within(dialog).getByLabelText(/email/i), 'nour@agency.com')
    await user.type(within(dialog).getByLabelText(/^password/i), 'password123')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    expect(within(dialog).getAllByText('Required.').length).toBe(1)
  })

  /* password min_length=8, and it is not in contracts/api.md at all - which is
     exactly why it is worth a test rather than a comment. */
  it('enforces the eight-character password minimum the schema requires', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    await user.type(within(dialog).getByLabelText(/email/i), 'nour@agency.com')
    await user.type(within(dialog).getByLabelText(/^password/i), 'short')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    expect(within(dialog).getByText(/at least 8 characters/i)).toBeInTheDocument()
  })

  it('creates an admin account and shows it with no agency', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    await user.type(within(dialog).getByLabelText(/email/i), 'nour@agency.com')
    await user.type(within(dialog).getByLabelText(/^password/i), 'password123')
    await user.selectOptions(within(dialog).getByLabelText(/^role/i), 'ADMIN')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText('Nour Sabri')).toBeInTheDocument()
    }, TABLE_WAIT)
    expect(screen.getAllByText('Global').length).toBeGreaterThan(1)
  })

  it('explains a duplicate email in words someone can act on', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    /* Already belongs to the seeded MANAGER. */
    await user.type(within(dialog).getByLabelText(/email/i), 'fatima@agency.com')
    await user.type(within(dialog).getByLabelText(/^password/i), 'password123')
    await user.selectOptions(within(dialog).getByLabelText(/^role/i), 'ADMIN')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText(/that email is already in use/i)).toBeInTheDocument()
    }, TABLE_WAIT)
  })

  /* PATCH /role is one request on its own, and the table must reflect it. */
  it('changes a role inline', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    const select = screen.getByLabelText('Role for Nadia Cherkaoui')
    await user.selectOptions(select, 'SECURITY')

    await waitFor(() => {
      expect(screen.getByLabelText('Role for Nadia Cherkaoui')).toHaveValue('SECURITY')
    }, TABLE_WAIT)
  })

  /**
   * An ADMIN cannot be demoted or given an agency through the API: PATCH /role
   * checks the new role against their existing (null) agency, and PATCH /agency
   * checks a new agency against their existing (ADMIN) role. No ordering works.
   * Offering either control would be offering an action that always fails.
   */
  it('does not offer a role or agency control for an admin', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.queryByLabelText('Role for Admin Test')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Agency for Admin Test')).not.toBeInTheDocument()
  })

  /* The backend answers 400 for this. Disabling it means nobody discovers the
     rule by having their own access taken away. */
  it('will not let you delete your own account', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.getByRole('button', { name: /delete fatima abbar/i })).toBeDisabled()
    expect(screen.getByText('(you)')).toBeInTheDocument()
  })

  /* Deleting an account destroys no attendance history, unlike deleting an
     employee. The two confirmations must not claim the same consequences. */
  it('says the employee record survives, then deletes', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /delete mehdi ouazzani/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/attendance history are not touched/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /delete account/i }))

    await waitFor(() => {
      expect(screen.queryByText('Mehdi Ouazzani')).not.toBeInTheDocument()
    }, TABLE_WAIT)
  })

  /* PUT accepts no role and no agency, so the edit dialog must not show them -
     a control whose value is silently dropped is worse than no control. */
  it('omits role and agency from the edit dialog', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /edit nadia cherkaoui/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByLabelText(/^role/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/^agency/i)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(/new password/i)).toHaveValue('')
  })
})
