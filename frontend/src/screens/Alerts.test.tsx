import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import Alerts from './Alerts'
import Occupancy from './Occupancy'

/* Mock mode drives both screens from the scripted fixtures in mocks/aiStreams,
   which emit a snapshot and then changes on a timer. The waits below are
   generous because the point is the sequence, not the speed. */
const WAIT = { timeout: 8000 }

function renderScreen(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('Alerts', () => {
  it('starts on the weapons feed and says all clear before anything is detected', async () => {
    renderScreen(<Alerts />)
    expect(await screen.findByText('All clear', {}, WAIT)).toBeInTheDocument()
  })

  it('shows a detection when a camera reports one', async () => {
    renderScreen(<Alerts />)
    expect(await screen.findByText('pistol', {}, WAIT)).toBeInTheDocument()
  })

  /* The feed only speaks when something changes, so quiet is normal. If the
     screen does not say that, an operator reads an empty panel as a dead
     system - or worse, a dead system as a safe building. */
  it('explains that silence is normal rather than broken', async () => {
    renderScreen(<Alerts />)
    await screen.findByText('All clear', {}, WAIT)
    expect(
      screen.getByText(/only sends a message when what a camera sees changes/i),
    ).toBeInTheDocument()
  })

  it('switches feeds without carrying detections across', async () => {
    const user = userEvent.setup()
    renderScreen(<Alerts />)
    await screen.findByText('pistol', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))

    /* A weapon detection must not survive into the watchlist panel - they are
       different sockets describing different things. */
    await waitFor(() => {
      expect(screen.queryByText('pistol')).not.toBeInTheDocument()
    }, WAIT)
  })

  /* For the watchlist feed, confidence is cosine similarity in [-1,1], not a
     probability. Rendering it as a percentage would be a fabrication about
     whether someone is a flagged person. */
  it('never renders watchlist confidence as a percentage', async () => {
    const user = userEvent.setup()
    renderScreen(<Alerts />)
    await screen.findByText('All clear', {}, WAIT)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))

    const match = await screen.findByText('MAROUANE-B-2024-114', {}, WAIT)
    expect(match).toBeInTheDocument()
    expect(screen.getByText(/similarity 0\.61/)).toBeInTheDocument()
    expect(screen.queryByText(/61%/)).not.toBeInTheDocument()
  })
})

describe('Occupancy', () => {
  it('lists every zone including one that is empty', async () => {
    renderScreen(<Occupancy />)
    expect(await screen.findByText('lobby', {}, WAIT)).toBeInTheDocument()
    /* vault starts at zero - an empty zone is measured, not missing. */
    expect(screen.getByText('vault')).toBeInTheDocument()
  })

  /* The bug this guards: a zone emptying and the screen keeping the last busy
     number, because the row was filtered out rather than set to zero. */
  it('keeps a zone visible after its count drops to zero', async () => {
    renderScreen(<Occupancy />)
    await screen.findByText('lobby', {}, WAIT)

    await waitFor(() => {
      const row = screen.getByText('lobby').closest('div')?.parentElement
      expect(row?.textContent).toMatch(/lobby0/)
    }, WAIT)
  })

  it('calls the total detections rather than a headcount', async () => {
    renderScreen(<Occupancy />)
    await screen.findByText('lobby', {}, WAIT)
    expect(screen.getByText('Detections across zones')).toBeInTheDocument()
    expect(screen.getByText(/counted in both/i)).toBeInTheDocument()
  })
})
