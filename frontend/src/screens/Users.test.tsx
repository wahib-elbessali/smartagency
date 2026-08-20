import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Users from './Users'
import { SessionContext } from '@/auth/SessionContext'
import { clearSession, setSession } from '@/api/tokenStore'
import type { User } from '@/api/types'
import { mockAdmin, mockManager } from '@/mocks/currentUser'
import { AGENCY_ID } from '@/mocks/fixtures/people'
import { resetUserStore } from '@/mocks/userStore'
import { resetEmployeeStore } from '@/mocks/employeeStore'
import '@/mocks'

/**
 * Every test here signs in as an ADMIN, because that is the only role this
 * screen can be reached with: the whole /api/users router is ADMIN-only.
 *
 * It used to sign in through the provider, which meant a MANAGER - the role the
 * login fixture hands out on the default scenario - and the suite passed
 * because the fixtures answered anyone. They enforce roles now (mocks/roles.ts),
 * so testing this screen as a manager would only ever assert the refusal state,
 * which is its own test at the bottom of this file.
 *
 * The session is supplied two ways at once and needs both: SessionContext is
 * what the component reads for "(you)" and for the role locks, and tokenStore
 * is what the fixtures read to decide whether the request is allowed - the
 * stand-in for the bearer token the backend would authorise against.
 */
function renderAs(user: User) {
  setSession({ accessToken: 'FIXTURE.ACCESS', refreshToken: 'FIXTURE.REFRESH', user })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext
        value={{
          status: 'authenticated',
          user,
          signIn: async () => {},
          signOut: () => {},
        }}
      >
        <MemoryRouter>
          <Users />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const renderScreen = () => renderAs(mockAdmin())

const TABLE_WAIT = { timeout: 4000 }

/**
 * Picks a role and confirms it.
 *
 * Choosing a role only ASKS now (2026-08-20) - the dropdown opens a dialog and
 * sends nothing until it is confirmed. Every test that wants the change applied
 * goes through here, so the two steps cannot drift apart in the tests while
 * being one step in somebody's head.
 */
async function changeRole(user: ReturnType<typeof userEvent.setup>, name: string, role: string) {
  await user.selectOptions(screen.getByLabelText(`Role for ${name}`), role)
  const dialog = await screen.findByRole('dialog', {}, TABLE_WAIT)
  await user.click(within(dialog).getByRole('button', { name: /change to/i }))
}

describe('Users', () => {
  beforeEach(() => {
    resetUserStore()
    resetEmployeeStore()
  })

  afterEach(clearSession)

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

  /**
   * Nobody is made an admin from this application (2026-08-20), so ADMIN is
   * absent from both role pickers - the create form and the table.
   *
   * The way in matters as much as the way out: locking the admin rows while
   * leaving ADMIN in a dropdown would have left one direction open, and a
   * promotion nobody could reverse from here is the worse trap of the two.
   */
  it('does not offer ADMIN when creating an account', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')

    const roles = within(dialog).getByLabelText(/^role/i)
    expect(within(roles).queryByRole('option', { name: 'ADMIN' })).not.toBeInTheDocument()
    expect(within(roles).getByRole('option', { name: 'MANAGER' })).toBeInTheDocument()
    /* Every role left needs a branch, so the picker is always there now. */
    expect(within(dialog).getByLabelText(/^agency/i)).toBeInTheDocument()
  })

  it('does not offer ADMIN in the table either', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    const roles = screen.getByLabelText('Role for Nadia Cherkaoui')
    expect(within(roles).queryByRole('option', { name: 'ADMIN' })).not.toBeInTheDocument()
    expect(within(roles).getByRole('option', { name: 'SECURITY' })).toBeInTheDocument()
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

  it('creates an account and shows it in the list', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.click(screen.getByRole('button', { name: /add account/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    await user.type(within(dialog).getByLabelText(/email/i), 'nour@agency.com')
    await user.type(within(dialog).getByLabelText(/^password/i), 'password123')
    await user.selectOptions(within(dialog).getByLabelText(/^role/i), 'SECURITY')
    await user.selectOptions(within(dialog).getByLabelText(/^agency/i), AGENCY_ID)
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText('Nour Sabri')).toBeInTheDocument()
    }, TABLE_WAIT)
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
    await user.selectOptions(within(dialog).getByLabelText(/^agency/i), AGENCY_ID)
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText(/that email is already in use/i)).toBeInTheDocument()
    }, TABLE_WAIT)
  })

  /* PATCH /access is one request on its own, and the table must reflect it. */
  it('changes a role inline once confirmed', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await changeRole(user, 'Nadia Cherkaoui', 'SECURITY')

    await waitFor(() => {
      expect(screen.getByLabelText('Role for Nadia Cherkaoui')).toHaveValue('SECURITY')
    }, TABLE_WAIT)
  })

  /**
   * Choosing a role asks before it does anything (2026-08-20).
   *
   * The three tests below are the promise the dialog makes: nothing is sent
   * until it is confirmed, cancelling leaves the account exactly as it was, and
   * what it describes is specific enough to check against what you meant.
   */
  it('sends nothing until the change is confirmed', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.selectOptions(screen.getByLabelText('Role for Nadia Cherkaoui'), 'MANAGER')
    await screen.findByRole('dialog', {}, TABLE_WAIT)

    /* The control goes back to what the account still is: it has changed
       nothing yet, and showing the new role would say otherwise. */
    expect(screen.getByLabelText('Role for Nadia Cherkaoui')).toHaveValue('AGENT')
  })

  it('leaves the account alone when the change is cancelled', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.selectOptions(screen.getByLabelText('Role for Nadia Cherkaoui'), 'MANAGER')
    const dialog = await screen.findByRole('dialog', {}, TABLE_WAIT)
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }, TABLE_WAIT)
    expect(screen.getByLabelText('Role for Nadia Cherkaoui')).toHaveValue('AGENT')
  })

  /* Named screens, not a general warning. "They will lose access to some
     things" is a sentence people click past. */
  it('names the screens the change opens and closes', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    await user.selectOptions(screen.getByLabelText('Role for Nadia Cherkaoui'), 'MANAGER')
    const dialog = await screen.findByRole('dialog', {}, TABLE_WAIT)

    /* An AGENT reaches the visitor queue; a MANAGER adds employees, agencies
       and presence, and gives up nothing. */
    expect(within(dialog).getByText(/gains/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Agencies/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Employees/)).toBeInTheDocument()
  })

  /**
   * An admin's role is not changed here, on any row.
   *
   * The product rule from testing (2026-08-20): changing roles is something an
   * admin does TO other accounts, never something done to theirs. It is
   * stricter than the API - PATCH /api/users/{id}/access commits the demotion
   * for anything calling it directly - so it is the screen that has to hold it,
   * and these are the tests that say so.
   *
   * It also retires, from this screen, the demotion PR #75 added for issue #71.
   */
  it('will not let an admin move their own account out of admin', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    /* No control at all, and the reason in the row rather than in a tooltip on
       text that does not look hoverable. */
    expect(screen.queryByLabelText('Role for Admin Test')).not.toBeInTheDocument()
    expect(screen.getByText(/your own account/i)).toBeInTheDocument()
  })

  /**
   * A peer admin, reached the only way left.
   *
   * Promoting somebody used to produce this row; nothing can promote now, so
   * the second admin has to already exist - which is the real case anyway, a
   * database seeded with more than one owner. Signing in as an admin who is not
   * the seeded one makes the seeded one the peer.
   */
  it("locks another admin's role too, not only your own", async () => {
    renderAs({ ...mockAdmin(), id: 'u-a-different-admin' })
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.queryByLabelText('Role for Admin Test')).not.toBeInTheDocument()
    /* The wording unique to a row that is not yours - both locks explain that
       an admin owns the system, so that phrase alone matches two rows. */
    expect(screen.getByText(/delete the account if it should no longer exist/i)).toBeInTheDocument()
  })

  /**
   * One admin does not administer another (2026-08-20).
   *
   * Stricter than the API, which lets an admin edit or delete any account but
   * their own - so the screen is the only thing holding it.
   */
  it("offers no edit or delete on another admin's account", async () => {
    renderAs({ ...mockAdmin(), id: 'u-a-different-admin' })
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.queryByRole('button', { name: /edit admin test/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete admin test/i })).not.toBeInTheDocument()
    /* Everyone else still has both. */
    expect(screen.getByRole('button', { name: /edit nadia cherkaoui/i })).toBeInTheDocument()
  })

  /* Your own admin row keeps Edit: a name, an email and a password are yours to
     change. Only Delete is refused there, and it stays visible-but-disabled so
     the reason has somewhere to live. */
  it('still lets an admin edit their own account', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.getByRole('button', { name: /edit admin test/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete admin test/i })).toBeDisabled()
  })

  /* An admin has no agency, so there is nothing to pick from in that column. */
  it('shows no branch picker on an admin row', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.queryByLabelText('Agency for Admin Test')).not.toBeInTheDocument()
    expect(screen.getByText('No branch')).toBeInTheDocument()
  })

  /* The backend answers 400 for this. Disabling it means nobody discovers the
     rule by having their own access taken away. */
  it('will not let you delete your own account', async () => {
    renderScreen()
    await screen.findByRole('table', {}, TABLE_WAIT)

    expect(screen.getByRole('button', { name: /delete admin test/i })).toBeDisabled()
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

  /**
   * The screen a MANAGER actually gets, which until the fixtures enforced roles
   * was unreachable without a real backend.
   *
   * Found by testing on fixtures: signed in as the manager the login fixture
   * hands out by default, this screen was fully usable - table, role dropdowns,
   * delete - when GET /api/users answers her with a 403. She could promote
   * people to ADMIN in a dashboard that would never let her.
   */
  it('shows a manager the refusal state rather than the table', async () => {
    renderAs(mockManager())

    expect(await screen.findByText(/administrators only/i, {}, TABLE_WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    /* And no Add button above the refusal - POST is ADMIN-only too. */
    expect(screen.queryByRole('button', { name: /add account/i })).not.toBeInTheDocument()
  })
})
