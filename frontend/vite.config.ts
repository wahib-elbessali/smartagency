/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const backend = process.env.VITE_DEV_BACKEND ?? 'http://127.0.0.1:8000'

/* Shared by the dev server and `vite preview`, so a production build can be
   checked locally the same way. Neither affects `vite build` output. */
const devProxy = {
  '/api': { target: backend, changeOrigin: true },
  '/ws': { target: backend, changeOrigin: true, ws: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  /* Dev-only proxy. `server` is ignored by `vite build`, so this changes
     nothing about production.

     It exists because backend/app/main.py installs no CORS middleware, so a
     browser on :5173 calling :8000 is blocked before the request is even sent.
     Proxying through the dev server makes every call same-origin, which is the
     usual fix and needs no backend change. Point VITE_API_BASE_URL at the dev
     server itself (http://localhost:5173) and the rest of the API layer is
     unchanged.

     ws: true matters - WS /ws/attendance is a protocol upgrade, and without it
     the proxy would answer the handshake with plain HTTP. */
  server: { proxy: devProxy },
  /* `vite preview` does NOT inherit server.proxy - it takes its own. Without
     this, checking a production build locally fails every request, which looks
     like the backend is down rather than a missing proxy. */
  preview: { proxy: devProxy },
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
