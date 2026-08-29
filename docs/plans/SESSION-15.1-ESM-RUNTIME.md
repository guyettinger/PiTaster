# Session 15.1: ESM Runtime

## Overview

Move the Electron main process to ESM and upgrade Electron so that Pi can be loaded
at all. Nothing about the agent changes in this sub-session — the Anthropic loop is
still live at the end of it. This exists so the runtime upgrade is not tangled with
the agent rewrite.

Pi is `"type": "module"`, uses `jiti` for dynamic extension loading, `import.meta.url`,
and a WASM dependency (`@silvia-odwyer/photon-node`). It **must not be bundled** — it
has to stay external and be loaded as real ESM at runtime.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: Session 14 complete
**Deliverable**: The app runs unchanged on Electron 39 with an ESM main process, and
`@earendil-works/pi-coding-agent` is importable from `src/main/`.

## Objectives

1. Upgrade Electron 33 → 39 (Node 20.18 → 22.20; Pi requires `>= 22.19.0`).
2. Upgrade electron-vite 2 → 5 and emit an ESM main bundle.
3. Externalize the Pi packages from the main bundle.
4. Replace every CJS-ism in `src/main/`.
5. Add the Pi dependencies; remove `@anthropic-ai/sdk` only once 15.3 lands.

---

## Task 1: apps/electron/package.json

```jsonc
{
  "name": "@anyapp/electron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "out/main/index.mjs",
  "dependencies": {
    "@anyapp/core": "workspace:*",
    "@anyapp/shared": "workspace:*",
    "@earendil-works/pi-ai": "^0.84.4",
    "@earendil-works/pi-coding-agent": "^0.84.4",
    "typebox": "^1.3.7",
    "@img/sharp-darwin-arm64": "^0.34.5",
    "ansi-to-html": "^0.7.2",
    "isomorphic-git": "^1.27.0",
    "nanoid": "^5.0.0",
    "sharp": "^0.33.0",
    "tree-kill": "^1.2.2",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "electron": "^39.0.0",
    "electron-vite": "^5.0.0"
  }
}
```

`@anthropic-ai/sdk` stays until 15.3 deletes `agent.ts`.

Electron 39 is the minimum that satisfies Pi's `engines`. 44 is the latest stable, but
39 bounds the Chromium blast radius — `PreviewPanel.tsx` still uses `<webview>`.

---

## Task 2: apps/electron/electron.vite.config.ts

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // Pi loads extensions through jiti and ships WASM; it cannot be rolled up.
        external: ['sharp', /^@earendil-works\//, 'typebox'],
        output: { format: 'es', entryFileNames: '[name].mjs' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // A sandboxed preload cannot be ESM.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } }
  }
})
```

The preload staying CJS is why `src/preload/index.ts` hand-duplicates every
`@anyapp/core` interface. That does not change.

---

## Task 3: CJS-isms in src/main/

`__dirname`, `__filename`, and `require` do not exist under ESM. Replace with:

```typescript
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
```

Known sites:

| File | What |
|------|------|
| `src/main/index.ts` | the `preload` path in `webPreferences` — now `index.cjs` |
| `src/main/ipc.ts` | reads `packages/shared/dist/inspector/overlay.js` off disk |

Sweep for the rest:

```bash
grep -rn "__dirname\|__filename\|require(" apps/electron/src/main/
```

---

## Task 4: Preload filename

The main process must point at `out/preload/index.cjs`, not `index.js`:

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

Every `BrowserWindow` in the app needs this — grep for `new BrowserWindow`.

---

## Verification

- [ ] `bun install` succeeds
- [ ] `bun run typecheck:all` passes
- [ ] `bun run build` produces `out/main/index.mjs` and `out/preload/index.cjs`
- [ ] `bun run dev` launches the app
- [ ] Create an app, send a chat message, get a response (still Anthropic)
- [ ] Inspect an element in the preview and add it to chat
- [ ] Run a sub-app and see its output in the terminal panel
- [ ] `node -e "import('@earendil-works/pi-coding-agent').then(m => console.log(Object.keys(m).length))"`
      resolves from `apps/electron/`

Nothing user-visible should have changed. If it did, that is a regression from the
Electron bump, not from Pi.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/electron/package.json` | **Modified** — `type: module`, Electron 39, electron-vite 5, Pi deps |
| `apps/electron/electron.vite.config.ts` | **Modified** — ESM main, CJS preload, Pi external |
| `apps/electron/src/main/index.ts` | **Modified** — ESM `__dirname`, `.cjs` preload path |
| `apps/electron/src/main/ipc.ts` | **Modified** — ESM `__dirname` |

---

## Commit Checkpoint

```bash
bun run typecheck:all && bun run build

git add -A
git commit -m "$(cat <<'EOF'
chore(electron): move main process to ESM on Electron 39

Pi (@earendil-works/pi-coding-agent) is ESM-only and requires Node >= 22.19.
Electron 39 bundles Node 22.20; Electron 33 bundled 20.18.

- main process emits ESM (out/main/index.mjs), preload stays CJS for sandbox
- Pi packages externalized from the main bundle (jiti + WASM cannot be rolled up)
- __dirname replaced with import.meta.url throughout src/main/

No behaviour change; the Anthropic agent loop is untouched.
EOF
)"
```
