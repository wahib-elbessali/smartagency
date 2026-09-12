import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentQueue from './AgentQueue'
import { SessionProvider } from '@/auth/session'
import { useSession } from '@/auth/SessionContext'
import { assignAgent, resetAssignmentStore } from '@/mocks/assignmentStore'
import { listTickets, resetTicketStore } from '@/mocks/ticketStore'
import '@/mocks'

function SignIn({ children }: { children: React.ReactNode }) {
  const { status, signIn } = useSession()
  if (status !== 'authenticated') {
    void signIn({ email: 'nadia@agency.com', password: 'password123' })
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
            <AgentQueue />
          </SignIn>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }

/* "Nobody yet" is on screen from the first render regardless of whether the
   queue has loaded, so it is not a signal that a button is usable yet - each
   starts disabled until the queue query resolves and finds someone waiting.
   Wait on the button itself, the same pattern VisitorQueue.test.tsx uses for
   Call. */
async function enabled(name: RegExp) {
  /* findByRole, not getByRole: Done and Problem do not exist until a ticket is
     being served, so waiting only on `toBeEnabled` would throw on the lookup
     before the button had a chance to appear. */
  const button = await screen.findByRole('button', { name }, WAIT)
  await waitFor(() => expect(button).toBeEnabled(), WAIT)
  return button
}

const noteField = () => screen.queryByLabelText(/what went wrong/i)

describe('AgentQueue', () => {
  beforeEach(() => {
    resetTicketStore()
    resetAssignmentStore()
  })

  /* Nadia is pre-assigned to Guichet 1 / Virement et consultation in the seed
     (assignmentStore.ts) - there is no picker to click through any more. */
  it('goes straight to serving the assigned service, no picker', async () => {
    renderScreen()

    expect(await screen.findByText('Virement et consultation', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Nobody yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ouverture de compte' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guichet 1' })).not.toBeInTheDocument()

    /* Both of VIR's seeded waiting tickets are visible behind whoever is
       current - visibility, not just a count. */
    await screen.findByText('Rachid El Fassi', {}, WAIT)
    expect(screen.getByText('Khadija Moussaoui')).toBeInTheDocument()
  })

  /* The path an agent takes almost every time: call someone, serve them, done.
     Rachid and Khadija are VIR's two seeded waiting tickets, oldest first. */
  it('calls the next ticket, then Done finishes it and calls the one after', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Virement et consultation', {}, WAIT)

    /* Waiting on the Done button rather than Rachid's name: his name is
       already on screen in the "Behind them" list before anyone is called, so
       it is not proof the click's mutation finished. Done only renders once
       `current` is set, which is. */
    await user.click(await enabled(/^call next$/i))
    await screen.findByRole('button', { name: /^done$/i }, WAIT)
    /* Rachid moved from "behind" to "now serving" - only Khadija is left
       behind him. Waited on the count rather than checked immediately: the
       queue refetch that drops him from "Behind them" is a separate, slightly
       later state update than the one that set `current`. */
    await waitFor(() => expect(screen.getByText('1 person')).toBeInTheDocument(), WAIT)
    expect(screen.getByText('Rachid El Fassi')).toBeInTheDocument()

    /* Nothing to fill in on the way through. This is the whole point of the
       change: the note is not in the path of a visit that went fine. */
    expect(noteField()).not.toBeInTheDocument()

    await user.click(await enabled(/^done$/i))
    await waitFor(
      () => expect(screen.getByText(/nobody else is waiting/i)).toBeInTheDocument(),
      WAIT,
    )
    expect(screen.getByText('Khadija Moussaoui')).toBeInTheDocument()
    expect(screen.queryByText('Rachid El Fassi')).not.toBeInTheDocument()

    const rachid = listTickets().find((t) => t.status === 'COMPLETED')
    expect(rachid?.outcome).toBe('SUCCESS')
    expect(rachid?.notes).toBeNull()

    /* Nobody left after Khadija - Done finishes her and has nobody to call. */
    await user.click(await enabled(/^done$/i))
    await waitFor(() => expect(screen.getByText('Nobody yet')).toBeInTheDocument(), WAIT)
  }, 20_000)

  it('asks what went wrong only after Problem, and will not send it empty', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Virement et consultation', {}, WAIT)

    await user.click(await enabled(/^call next$/i))
    await screen.findByRole('button', { name: /^problem$/i }, WAIT)
    expect(noteField()).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^problem$/i }))
    expect(noteField()).toBeInTheDocument()

    /* A problem with no reason is the one thing this must not record - the
       reason IS the record. Whitespace does not count as one. */
    expect(screen.getByRole('button', { name: /record problem/i })).toBeDisabled()
    await user.type(noteField()!, '   ')
    expect(screen.getByRole('button', { name: /record problem/i })).toBeDisabled()

    await user.clear(noteField()!)
    await user.type(noteField()!, 'Papers incomplete')
    await user.click(await enabled(/record problem/i))

    /* Back to the two-button state for the next person, which only happens
       once the mutation lands - and is therefore also the signal that the
       write below has actually been made. Khadija's name is no use as one:
       she is already on screen in "Behind them" before any of this. */
    await screen.findByRole('button', { name: /^done$/i }, WAIT)
    expect(noteField()).not.toBeInTheDocument()

    const rachid = listTickets().find((t) => t.status === 'COMPLETED')
    expect(rachid?.outcome).toBe('PROBLEM')
    expect(rachid?.notes).toBe('Papers incomplete')
  }, 20_000)

  /* Pressing Problem is not a commitment - an agent who hits it by accident,
     or resolves the problem after all, gets back without recording one. */
  it('lets an agent back out of reporting a problem', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Virement et consultation', {}, WAIT)

    await user.click(await enabled(/^call next$/i))
    await user.click(await enabled(/^problem$/i))
    await user.type(noteField()!, 'Typed by mistake')
    await user.click(screen.getByRole('button', { name: /^back$/i }))

    expect(noteField()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument()
    expect(listTickets().every((t) => t.outcome === null)).toBe(true)

    /* The typing is gone too, not hidden - pressing Problem again starts
       clean rather than resurrecting an abandoned draft. */
    await user.click(screen.getByRole('button', { name: /^problem$/i }))
    expect(noteField()).toHaveValue('')
  }, 20_000)

  it('tells an unassigned agent to ask their manager, with no picker to fall back on', async () => {
    /* Overwrite the seed as if nobody has assigned this agent yet. */
    assignAgent('u1000000-0000-4000-8000-000000000005', null)

    renderScreen()

    expect(
      await screen.findByText(/hasn't put you on a counter yet/i, {}, WAIT),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^call next$/i })).not.toBeInTheDocument()
  })
})
