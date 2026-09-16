import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import VisitorQueue from './VisitorQueue'
import { SessionProvider } from '@/auth/session'
import { useSession } from '@/auth/SessionContext'
import { resetAssignmentStore } from '@/mocks/assignmentStore'
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
        <MemoryRouter>
          <SignIn>
            <VisitorQueue />
          </SignIn>
        </MemoryRouter>
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
  })

  /* Nadia is pre-assigned to Guichet 1 / VIR in the seed (assignmentStore.ts),
     and VIR has two seeded waiting tickets (Rachid, Khadija). */
  it('shows each agent’s assignment and how many are waiting for their service', async () => {
    renderScreen()

    expect(await screen.findByText('Nadia Cherkaoui', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Virement et consultation · Guichet 1')).toBeInTheDocument()
    expect(screen.getByText('2 waiting')).toBeInTheDocument()
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
})
