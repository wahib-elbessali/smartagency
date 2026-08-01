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
  },
})
