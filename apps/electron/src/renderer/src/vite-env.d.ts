/// <reference types="vite/client" />

/**
 * Vite's client types, for the `?worker` import suffix Monaco's workers use.
 *
 * Scoped to the renderer, which is the only context Vite's import suffixes exist in —
 * putting `vite/client` in the shared `tsconfig.json` would hand `import.meta.env` and
 * the asset-suffix module declarations to the main and preload builds too, where they
 * describe nothing real.
 */
