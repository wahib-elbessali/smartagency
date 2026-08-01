# Frontend security notes

The dashboard is a client bundle. Anything it holds, a person with the page open
holds too. These are the rules that follow from that, and what enforces each.

## No secrets in the bundle

Vite inlines every `VITE_`-prefixed variable into the built JavaScript **in
plain text**. `VITE_API_BASE_URL` is a URL and fine. An API key, a token, a
database password or a signing secret is not — it ships to every viewer.

Anything secret stays on the backend, behind an endpoint.

Enforced by `src/checks/bundle.test.ts`, which builds nothing but scans the
committed `.env.example` and fails if a variable name looks like a credential.

## XSS

React escapes interpolated values, so the realistic hole is
`dangerouslySetInnerHTML`, `eval`, and `javascript:` URLs.

Enforced by lint: `react/no-danger`, `react/no-danger-with-children`, `no-eval`
and `no-script-url` are **errors** in `.oxlintrc.json`, so `npm run lint` fails
rather than a reviewer having to spot it.

If a screen ever genuinely needs to render backend HTML, that is a conversation
before it is a code change — sanitising on the client is the weakest place to do
it.

## CSRF

Not yet applicable and deliberately not guessed at.

`src/api/client.ts` sets `credentials: 'same-origin'` explicitly rather than
relying on the default. If the backend ends up using cookie sessions, two things
have to change together:

1. `credentials` becomes `'include'`
2. state-changing requests echo a CSRF token

The token's header name and how it is issued are the **backend's** to define.
They are not invented here. If instead we get bearer tokens, CSRF stops being
relevant and token storage becomes the question — in which case keep it in
memory, not `localStorage`, so an XSS can't read it back out.

## Auth

`src/auth/` has the session state, the route guard, and the login screen. The
sign-in _request_ is missing because `contracts/api.md` has no authentication
endpoint. `VITE_AUTH_ENFORCED` is `false` until it does — turning it on now puts
every screen behind a login that cannot succeed.

## Still open

- **Content-Security-Policy.** Belongs on whatever serves the built assets, as a
  response header, so it is a deployment decision rather than a frontend one.
  Worth raising once we know how this gets served.
- **Dependency advisories.** `npm audit` is clean today. Nothing runs it on a
  schedule yet.
