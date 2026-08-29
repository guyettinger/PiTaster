import { defineConfig } from 'electron-vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(rootDir, 'src/main/index.ts') },
        // Pi loads extensions through jiti and ships WASM; it cannot be rolled up.
        external: ['sharp', /^@earendil-works\//, 'typebox'],
        output: { format: 'es', entryFileNames: '[name].mjs' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(rootDir, 'src/preload/index.ts') },
        // A sandboxed preload cannot be ESM.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(rootDir, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve(rootDir, 'src/renderer/src')
      }
    }
  }
})
