/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    /* jsdom is pinned to 26.x on purpose. jsdom 30 declares
       engines.node ^22.22.2 || ^24.15.0 || >=26, and frontend_ci.yml runs
       Node 20 - there it fails with
       "TypeError: webidl.util.markAsUncloneable is not a function",
       because that Node API does not exist before 22. jsdom 26 supports
       Node >=18. Don't bump it without also raising the CI Node version. */
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    /* Pin the environment the suite runs in.
    
       Vitest loads .env.local like Vite does, so without this the tests inherit
       whatever a developer happens to have configured for local development.
       Point .env.local at a real backend - which is exactly what you do to work
       against one - and the suite starts failing: VITE_USE_MOCKS=false stops
       the fixtures serving, and VITE_AUTH_ENFORCED=true makes the route guard
       redirect in a test asserting it stays inert.
    
       These are the defaults from .env.example, so the suite tests the state a
       fresh clone is in. Individual tests still override with vi.stubEnv, and
       vi.unstubAllEnvs restores to these rather than to someone's .env.local. */
    env: {
      VITE_USE_MOCKS: 'true',
      VITE_MOCK_SCENARIO: 'normal',
      VITE_AUTH_ENFORCED: 'false',
      VITE_API_BASE_URL: '',
      VITE_WS_BASE_URL: '',
      VITE_WS_AUTH_MODE: '',
    },
  },
})
