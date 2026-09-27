import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Faces from './Faces'
import { enrollFace } from '@/api/endpoints/faces'
import { clearSession, setSession } from '@/api/tokenStore'
import type { Role } from '@/api/types'
import { ScopeProvider } from '@/agency/scope'
import { SessionContext, type SessionValue } from '@/auth/SessionContext'
import { mockUserForRole } from '@/mocks/currentUser'
import { createEmployee, listEmployees, resetEmployeeStore } from '@/mocks/employeeStore'
import * as faceStore from '@/mocks/faceStore'
import { AGENCY_ID, AGENCY_ID_RABAT } from '@/mocks/fixtures/people'
import '@/mocks'

/* Session in both places, for the reason Zones.test.tsx gives. */
function renderAs(role: Role) {
  const user = mockUserForRole(role)
  setSession({ accessToken: 'mock-token', refreshToken: 'mock-refresh', user })
  const session: SessionValue = {
    status: 'authenticated',
    user,
    signIn: async () => {},
    signOut: () => {},
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext value={session}>
        <ScopeProvider>
          <MemoryRouter>
            <Faces />
          </MemoryRouter>
        </ScopeProvider>
      </SessionContext>
    </QueryClientProvider>,
  )
}

const WAIT = { timeout: 4000 }
const photo = () => new File(['face'], 'face.jpg', { type: 'image/jpeg' })

describe('Face enrollment', () => {
  beforeEach(() => {
    faceStore.resetFaceStore()
    resetEmployeeStore()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  const firstHere = () => listEmployees().find((employee) => employee.agency_id === AGENCY_ID)

  it('lists the branch’s employees, enrolled or not, never a photo', async () => {
    renderAs('MANAGER')
    const first = firstHere()
    expect(await screen.findByText('enrolled · 2 photos', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText(`${first?.first_name} ${first?.last_name}`)).toBeInTheDocument()
    expect(screen.getAllByText('not enrolled').length).toBeGreaterThan(0)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  /* Enrolling again adds a photo - the backend accumulates them. */
  it('adds another photo for an enrolled employee', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    const first = firstHere()
    const name = `${first?.first_name} ${first?.last_name}`
    await user.click(await screen.findByRole('button', { name: `Add a photo for ${name}` }, WAIT))
    const dialog = await screen.findByRole('dialog')
    await user.upload(within(dialog).getByLabelText(/^photo/i), photo())
    await user.click(within(dialog).getByRole('button', { name: 'Enroll photo' }))

    expect(await screen.findByText('enrolled · 3 photos', {}, WAIT)).toBeInTheDocument()
  })

  it('removes every photo for an employee', async () => {
    const user = userEvent.setup()
    renderAs('MANAGER')
    const first = firstHere()
    const name = `${first?.first_name} ${first?.last_name}`
    await user.click(
      await screen.findByRole('button', { name: `Remove ${name}'s face data` }, WAIT),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(faceStore.listFaces(null)).toHaveLength(0), WAIT)
  })

  it('does not offer enrollment for an inactive employee', async () => {
    createEmployee({
      first_name: 'Retired',
      last_name: 'Person',
      agency_id: AGENCY_ID,
      status: 'INACTIVE',
    })
    renderAs('MANAGER')
    expect(await screen.findByText('Retired Person', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('inactive — cannot enroll')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll Retired Person' })).not.toBeInTheDocument()
  })

  it('refuses a manager enrolling another branch’s employee', async () => {
    const rabat = createEmployee({
      first_name: 'Samir',
      last_name: 'Rabat',
      agency_id: AGENCY_ID_RABAT,
    })
    setSession({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      user: mockUserForRole('MANAGER'),
    })
    await expect(enrollFace(rabat.id, photo())).rejects.toMatchObject({ status: 403 })
  })
})
