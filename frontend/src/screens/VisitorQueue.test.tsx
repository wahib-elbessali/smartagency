import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import VisitorQueue from './VisitorQueue'
import { ScopeProvider } from '@/agency/scope'
import { SessionProvider } from '@/auth/session'
import { useSession } from '@/auth/SessionContext'
import { resetAssignmentStore } from '@/mocks/assignmentStore'
import { resetServiceStore, SERVICE_ID_OUV, updateService } from '@/mocks/serviceStore'
import { resetTicketStore } from '@/mocks/ticketStore'
import '@/mocks'

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
        <ScopeProvider>
          <MemoryRouter>
            <SignIn>
              <VisitorQueue />
            </SignIn>
          </MemoryRouter>
        </ScopeProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

/* This screen is oversight only now (2026-09-05): who's assigned where, and
   how their line is doing. Running the queue itself moved to AgentQueue. */
describe('VisitorQueue', () => {
  beforeEach(() => {
    resetTicketStore()
    resetAssignmentStore()
    resetServiceStore()
  })

  /* Nadia is pre-assigned to Guichet 1 / VIR in the seed (assignmentStore.ts),
     and VIR has two seeded waiting tickets (Rachid, Khadija). */
  it('shows each agent’s assignment and how many are waiting for their service', async () => {
    renderScreen()

    expect(await screen.findByText('Nadia Cherkaoui', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Virement et consultation · Guichet 1')).toBeInTheDocument()
    /* The queue is its own query and can land after the agents list. */
    expect(await screen.findByText('2 waiting', {}, WAIT)).toBeInTheDocument()
  })

  /* Guichet 2 is deliberately absent from the dropdown's options - it has no
     service assigned (ticketStore.ts's COUNTERS), so it can't back an agent
     assignment either. Guichet 3 (OUV) is the only other valid target. */
  it('reassigns an agent to a different counter and service', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Nadia Cherkaoui', {}, WAIT)

    const select = screen.getByLabelText(/assign nadia cherkaoui/i)
    await waitFor(() => expect(select).toBeEnabled(), WAIT)
    expect(within(select).queryByText(/guichet 2/i)).not.toBeInTheDocument()

    await user.selectOptions(select, within(select).getByRole('option', { name: /guichet 3/i }))

    await waitFor(() => {
      expect(screen.getByText('Ouverture de compte · Guichet 3')).toBeInTheDocument()
    }, WAIT)
    /* Salma Bennani is OUV's one seeded waiting ticket. */
    expect(screen.getByText('1 waiting')).toBeInTheDocument()
  })

  it('clears an assignment back to "Not assigned"', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Nadia Cherkaoui', {}, WAIT)

    const select = screen.getByLabelText(/assign nadia cherkaoui/i)
    await waitFor(() => expect(select).toBeEnabled(), WAIT)
    await user.selectOptions(select, within(select).getByRole('option', { name: /not assigned/i }))

    /* "Not assigned" is also the dropdown's own placeholder option, present
       from the first render regardless of state - waiting for the waiting
       count to disappear is the real signal that the mutation landed. */
    await waitFor(() => expect(screen.queryByText(/\d waiting/)).not.toBeInTheDocument(), WAIT)
    expect(screen.getByText('Not assigned', { selector: 'p' })).toBeInTheDocument()
  })

  /* contracts/api.md §5: the counter must have an ACTIVE service or the
     route answers 409, so a counter whose service is switched off is not
     offered as a target at all. */
  it('does not offer a counter whose service is inactive', async () => {
    updateService(SERVICE_ID_OUV, { is_active: false })
    renderScreen()
    await screen.findByText('Nadia Cherkaoui', {}, WAIT)

    const select = screen.getByLabelText(/assign nadia cherkaoui/i)
    await waitFor(() => expect(select).toBeEnabled(), WAIT)
    await waitFor(
      () => expect(within(select).queryByText(/guichet 3/i)).not.toBeInTheDocument(),
      WAIT,
    )
  })

  /* The service can be switched off after the picker loaded. The refusal is
     worded as an assignment problem - not the ticket wording this screen
     used to borrow, which would have said a ticket "has already been
     handled". */
  it('explains a 409 in terms of the counter, not a ticket', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Nadia Cherkaoui', {}, WAIT)

    const select = screen.getByLabelText(/assign nadia cherkaoui/i)
    await waitFor(() => expect(select).toBeEnabled(), WAIT)
    const guichet3 = await within(select).findByRole('option', { name: /guichet 3/i }, WAIT)

    updateService(SERVICE_ID_OUV, { is_active: false })
    await user.selectOptions(select, guichet3)

    expect(
      await screen.findByText(/no longer has an active service/i, {}, WAIT),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ticket has already been handled/i)).not.toBeInTheDocument()
  })
})
