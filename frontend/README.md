# Frontend

The SmartAgency dashboard. Consumes the public endpoints described in
[`contracts/api.md`](../contracts/api.md).

## Status

Not scaffolded yet — no stack has been chosen. See `#blockers` (tagged
`frontend`) for the open decision.

## Working here

- `contracts/api.md` is the source of truth for every endpoint path, field
  name, and response shape. Don't guess a field name; if the contract doesn't
  cover it, ask in `#blockers` and get the contract updated first.
- There's no live backend to develop against day to day. Build against your
  own mocks/fixtures, as described in the mock-first section of
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## CI

`.github/workflows/frontend_ci.yml` runs on any PR touching `frontend/**`.

It currently no-ops. Once `frontend/package.json` **and**
`frontend/package-lock.json` both exist, it runs:

```
npm ci
npm run lint
npm run build
```

So whoever scaffolds needs to commit the lockfile and define both `lint` and
`build` scripts, or the first real frontend PR fails CI immediately.
