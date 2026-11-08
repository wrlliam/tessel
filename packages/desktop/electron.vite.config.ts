import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // Workspace packages are TypeScript source, so bundle them; everything else loads from node_modules.
    build: { externalizeDeps: { exclude: ['@tessel/core', '@tessel/server'] } },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
