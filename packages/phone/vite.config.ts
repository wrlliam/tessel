import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const desktop = 'http://127.0.0.1:4747'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // Forward to a running desktop app so `pnpm --filter @tessel/phone dev` has hot reload.
    proxy: {
      '/api': { target: desktop, changeOrigin: false },
      '/ws': { target: desktop, ws: true, changeOrigin: false },
    },
  },
  build: { target: 'safari16' },
})
