/// <reference types="vite/client" />

/**
 * Every VITE_ variable is inlined into the client bundle as plain text and is
 * readable by anyone with the page open. Nothing secret goes here.
 */
interface ImportMetaEnv {
  /** 'false' hits VITE_API_BASE_URL; anything else serves fixtures. */
  readonly VITE_USE_MOCKS?: string
  /** Origin of the backend, e.g. http://localhost:8000. Unused while mocking. */
  readonly VITE_API_BASE_URL?: string
  /** Which fixture variant to serve: normal | empty | large | error. */
  readonly VITE_MOCK_SCENARIO?: string
  /** 'true' turns on the route guard. Needs an auth endpoint to be useful. */
  readonly VITE_AUTH_ENFORCED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
