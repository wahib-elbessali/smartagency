/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' serves fixtures from src/mocks; anything else hits VITE_API_BASE_URL. */
  readonly VITE_USE_MOCKS?: string
  /** Origin of Ahmed's backend, e.g. http://localhost:8000. Unused while mocking. */
  readonly VITE_API_BASE_URL?: string
  /** Which fixture variant to serve: normal | empty | large | error. */
  readonly VITE_MOCK_SCENARIO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
