import { registerMock, registerMockWriter } from '../registry'
import type { Agency, AgencyCreate, AgencyUpdate } from '@/api/types'
import * as store from '../agencyStore'

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
registerMock<Agency[]>('GET /api/agencies', {
  normal: () => store.listAgencies(),
  empty: () => [],
  large: () => store.listAgencies(),
})

/* The id is in the path, not the body - same as the real request. Parsing it
   back out keeps the mock path and the HTTP path identical, so nothing extra
   has to be smuggled into the request just to make fixtures work. */
function idFrom(path: string): string {
  return path.split('/').pop() ?? ''
}

registerMock<Agency>('GET /api/agencies/{id}', {
  normal: () => store.listAgencies()[0],
  empty: () => store.listAgencies()[0],
  large: () => store.listAgencies()[0],
})

registerMockWriter('POST /api/agencies', (body) => store.createAgency(body as AgencyCreate))

registerMockWriter('PUT /api/agencies/{id}', (body, path) =>
  store.updateAgency(idFrom(path), body as AgencyUpdate),
)

registerMockWriter('DELETE /api/agencies/{id}', (_body, path) => {
  store.deleteAgency(idFrom(path))
  return undefined
})
