import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import VisitorQueue from './VisitorQueue'
import { SessionProvider } from '@/auth/session'
import { useSession } from '@/auth/SessionContext'
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

/* Counters arrive from the agencies query, which is separate from the queue
   one. Call stays disabled until they land, so clicking it the instant the
   roster renders is a race - wait for the control to actually be usable. */
async function firstEnabledCall() {
  const button = screen.getAllByRole('button', { name: /^call$/i })[0]
  await waitFor(() => expect(button).toBeEnabled(), WAIT)
  return button
}

describe('VisitorQueue', () => {
  beforeEach(resetTicketStore)

  it('lists who is waiting, oldest first', async () => {
    renderScreen()
    expect(await screen.findByText('Rachid El Fassi', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Khadija Moussaoui')).toBeInTheDocument()
  })

  /* service_type is nullable and one seeded ticket has none. A row that assumed
     it was present would render an empty badge. */
  it('renders a ticket with no service type', async () => {
    renderScreen()
    await screen.findByText('Youssef Amrani', {}, WAIT)
    expect(screen.getByText('Youssef Amrani')).toBeInTheDocument()
  })

  it('registers a visitor and issues them a ticket in one step', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(screen.getByRole('button', { name: /register visitor/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/full name/i), 'Nour Sabri')
    await user.click(within(dialog).getByRole('button', { name: /register and issue ticket/i }))

    await waitFor(() => {
      expect(screen.getByText('Nour Sabri')).toBeInTheDocument()
    }, WAIT)
  })

  it('will not register someone without a name', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(screen.getByRole('button', { name: /register visitor/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /register and issue ticket/i }))

    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
  })

  /**
   * The endpoint returns WAITING tickets only, so calling someone removes them
   * from the queue. The screen has to move them into its own panel or they
   * disappear entirely - which is the whole reason that panel exists.
   */
  it('moves a called visitor out of the queue and into the counter panel', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(await firstEnabledCall())
    await user.click(screen.getByRole('button', { name: 'Guichet 1' }))

    await waitFor(() => {
      expect(screen.getByText('At a counter')).toBeInTheDocument()
    }, WAIT)
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
  })

  /* A closed counter is a 409 from the backend, so it must not be clickable. */
  it('does not let you call anyone to a closed counter', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(await firstEnabledCall())
    expect(screen.getByRole('button', { name: 'Guichet 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guichet 1' })).toBeEnabled()
  })

  it('completes a visitor and clears them from the counter panel', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(await firstEnabledCall())
    await user.click(screen.getByRole('button', { name: 'Guichet 1' }))
    await waitFor(() => expect(screen.getByText('At a counter')).toBeInTheDocument(), WAIT)

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => {
      expect(screen.queryByText('At a counter')).not.toBeInTheDocument()
    }, WAIT)
  })

  it('removes a cancelled visitor from the queue', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)

    await user.click(screen.getByRole('button', { name: /cancel .*-001/i }))

    await waitFor(() => {
      expect(screen.queryByText('Rachid El Fassi')).not.toBeInTheDocument()
    }, WAIT)
  })

  /* The limitation is a design constraint, not a detail to bury - somebody
     reading the screen has to know the panel is tab-local. */
  it('says on screen that called visitors are not persisted', async () => {
    renderScreen()
    await screen.findByText('Rachid El Fassi', {}, WAIT)
    expect(screen.getByText(/reloading\s+clears the panel/i)).toBeInTheDocument()
  })
})
