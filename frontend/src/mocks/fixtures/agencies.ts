import { registerMock, registerMockWriter } from '../registry'
import type { Agency, AgencyCreate, AgencyUpdate } from '@/api/types'
import * as store from '../agencyStore'
import { requestUser } from '../currentUser'

/**
 * Field names from GET /api/agencies.
 *
 * `normal` reads through the writable store so an agency created in the admin
 * screen actually appears in the list. `empty` and `large` stay frozen - they
 * exist to test rendering at the extremes, not to be edited.
 *
 * `empty` matters more here than elsewhere: with no agency there is no
 * opening_time, and the presence screen cannot derive "late" at all. That is a
 * real state worth being able to look at, not a degenerate one.
 */

/**
 * A MANAGER sees one branch: their own. Reported in testing as "the manager
 * should see the agencies he got access to" - and it was already true against
 * the backend, where list_agencies filters on current_user.agency_id and every
 * other route answers 403 with "Acces limite a votre agence". Only the fixtures
 * handed out the whole estate, so on mock data a manager saw two branches and
 * an Edit button that the real API refuses.
 *
 * The scoping belongs here rather than in agencyStore, and certainly not in the
 * screen: the store is the table, this file is the route, and the endpoint
 * module says it outright - a MANAGER's list arrives already filtered and the
 * frontend must not filter it a second time. This layer IS the backend when
 * mocks are on, so filtering here is the backend doing its job, not the
 * frontend second-guessing it.
 */
function visibleTo(agencies: Agency[]): Agency[] {
  const user = requestUser()
  if (user?.role !== 'MANAGER') return agencies
  return agencies.filter((agency) => agency.id === user.agency_id)
}

registerMock<Agency[]>('GET /api/agencies', {
  normal: () => visibleTo(store.listAgencies()),
  empty: () => [],
  large: () => visibleTo(store.listAgencies()),
})

/* The id is in the path, not the body - same as the real request. Parsing it
   back out keeps the mock path and the HTTP path identical, so nothing extra
   has to be smuggled into the request just to make fixtures work. */
function idFrom(path: string): string {
  return path.split('/').pop() ?? ''
}

/**
 * One agency - and it cannot honour the id, because a read variant is called
 * with no arguments (registry.ts) and only the writers are handed the path. So
 * it answers with the first branch the caller is entitled to see, which for a
 * MANAGER is theirs rather than whichever row happens to sort first.
 *
 * Nothing calls fetchAgency yet; it exists for a detail view. When something
 * does, the id has to reach this function before the mock means anything, and
 * that is a change to the read signature in registry.ts rather than to this
 * file. Scoped now anyway so the boundary is not the thing that gets forgotten.
 */
registerMock<Agency>('GET /api/agencies/{id}', {
  normal: () => visibleTo(store.listAgencies())[0],
  empty: () => visibleTo(store.listAgencies())[0],
  large: () => visibleTo(store.listAgencies())[0],
})

registerMockWriter('POST /api/agencies', (body) => store.createAgency(body as AgencyCreate))

registerMockWriter('PUT /api/agencies/{id}', (body, path) =>
  store.updateAgency(idFrom(path), body as AgencyUpdate),
)

registerMockWriter('DELETE /api/agencies/{id}', (_body, path) => {
  store.deleteAgency(idFrom(path))
  return undefined
})
