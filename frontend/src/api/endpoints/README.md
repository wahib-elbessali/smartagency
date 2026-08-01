# `src/api/endpoints/`

One file per endpoint. Each exports a typed function that screens call, and it
is the only thing allowed to name a `contracts/api.md` path.

**This directory is empty on purpose.** `contracts/api.md` currently contains
only its entry template — zero endpoints. Writing an endpoint module now would
mean inventing a path and a response shape, which is the one rule this project
does not bend.

Shape to follow once an entry exists:

```ts
import { fetchJson } from '@/api/client'

// Field names copied from the contract entry, exact casing.
export interface SomethingResponse {
  /* ... */
}

export const somethingEndpoint = {
  key: '/the/contract/path',
  path: '/the/contract/path',
} as const

export function getSomething(signal?: AbortSignal) {
  return fetchJson<SomethingResponse>(somethingEndpoint, signal)
}
```

Re-read the contract entry each time you touch one of these — not the fixture
you wrote three weeks ago.
