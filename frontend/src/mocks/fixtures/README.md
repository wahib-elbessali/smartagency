# `src/mocks/fixtures/`

One file per endpoint group, each calling `registerMock()` with its variants:
`normal`, `empty`, `large`, and optionally `error`.

Register every file in `src/mocks/index.ts` so it loads at startup — a fixture
nobody imports never registers, and the endpoint fails with `not_implemented`
as though it had never been written.

## Read fixtures vs writable stores

A fixture set is four pure functions keyed by scenario. That works for reads
and not at all for writes: a create has a request body, has to change what
subsequent reads return, and can legitimately fail on a uniqueness clash. So
anything writable lives in a **store** next door — one per endpoint group
(`agencyStore`, `employeeStore`, `userStore`, `ticketStore`, `serviceStore`,
`deviceStore`, `thresholdStore`, `attendanceStore`,
`assignmentStore`; `readingStore` is the read-only exception, since only the
hardware writes a reading) — and the fixture registers it with
`registerMockWriter()`.

Where a store exists, the `normal` variant should read **through** it rather
than returning a frozen array, or a row created in the UI will not appear in
the list that follows. `empty` and `large` stay frozen: they exist to test
rendering at the extremes, not to be edited.

Stores also enforce the refusals the backend enforces, with the same status
codes — a duplicate counter number is a 409, a name outside 2–150 characters is
a 422. A mock that accepts everything produces a form nobody has actually
tested, and the first real refusal then arrives in front of a user.

## Shape to follow

```ts
import { registerMock, registerMockWriter } from '../registry'
import type { Something, SomethingCreate } from '@/api/types'
import * as store from '../somethingStore'

/* The key is the same `METHOD /path` string the endpoint module uses, with
   `{id}` for a path parameter. Variants receive the request path, which is how
   a fixture reads the id (or, for readings, the query string) back out. */
registerMock<Something[]>('GET /api/something', {
  normal: () => store.listSomething(),
  empty: () => [],
  large: () => store.listSomething(),
})

registerMockWriter('POST /api/something', (body) => store.createSomething(body as SomethingCreate))
```

Two more things a fixture is responsible for, because this layer _is_ the
backend when mocks are on:

- **Scoping.** The backend limits a non-ADMIN to their own agency. Read the
  caller from `requestUser()` (`mocks/currentUser.ts`) and filter or refuse
  the way the real route does — `fixtures/agencies.ts` filters, `fixtures/readings.ts`
  answers 403 — rather than handing every role the whole estate. Roles per
  router are gated once, in `mocks/roles.ts`.
- **PROPOSED routes.** A fixture may exist for an endpoint the backend has not
  built yet (`GET /api/devices/{id}/readings`, the agent assignment routes).
  Mark the type PROPOSED in `api/types.ts` with the exact shape to ask for, so
  the request does not change when it lands.

Copy field names from the contract character for character; `occupancy_count`
and `occupancyCount` are different fields. When a `BREAKING:` post appears in
`#api-contract`, come back and check these against the contract.

The VALUES are invented — that is what a fixture is — but no field name is.
