import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      // Workspace packages are TypeScript source, so bundle them; everything else loads from node_modules.
      // zx is bundled into zx-runner, which runs as plain Node outside the app archive.
      externalizeDeps: { exclude: ['@tessel/core', '@tessel/server', '@tessel/plugin-sdk', 'zx'] },
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Started in each plugin's own process.
          'plugin-runner': resolve(import.meta.dirname, '../plugin-sdk/src/runner.ts'),
          'zx-runner': resolve(import.meta.dirname, 'src/main/zx-runner.ts'),
        },
      },
    },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
