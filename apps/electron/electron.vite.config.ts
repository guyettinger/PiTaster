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
        // undici stays external for the same reason — it carries llhttp as WASM — and
        // because it must stay the single instance Pi's requests also go through.
        external: ['sharp', /^@earendil-works\//, 'typebox', 'undici'],
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
      // Never inline a font as a `data:` URI. The renderer CSP is `font-src 'self'`,
      // and an inlined face would silently fail to load under it — so the build has
      // to guarantee what the policy assumes, not merely happen to satisfy it today.
      assetsInlineLimit: (filePath: string) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
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
