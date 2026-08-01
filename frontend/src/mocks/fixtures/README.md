# `src/mocks/fixtures/`

One file per endpoint, each calling `registerMock()` with all four variants:
`normal`, `empty`, `large`, and optionally `error`.

**This directory is empty on purpose.** Fixture _contents_ are the only part of
the mock layer that needs real field names, and `contracts/api.md` has no
endpoint entries yet. Everything around them — the client, the scenario switch,
the fake latency, the loading/empty/error UI — is built and works without them.

Shape to follow once an entry exists:

```ts
import { registerMock } from '@/mocks/registry'
import { somethingEndpoint, type SomethingResponse } from '@/api/endpoints/something'

registerMock<SomethingResponse>(somethingEndpoint.key, {
  normal: () => ({/* copied field-for-field from the contract */}),
  empty: () => ({/* zero rows — the state that ships broken most often */}),
  large: () => ({/* 200 rows — does the table still work? */}),
})
```

Register the file in `src/mocks/index.ts` so it loads at startup.

Copy field names from the contract character for character; `occupancy_count`
and `occupancyCount` are different fields. When a `BREAKING:` post appears in
`#api-contract`, come back and check these against the contract.
