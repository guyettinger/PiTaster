# Session 15.2: Ollama Provider

## Overview

Give the app a model provider for the first time. Today `agent.ts:1035` constructs
`new Anthropic()` with no options and hardcodes `model: 'claude-sonnet-4-20250514'`
at line 1104. There is no provider abstraction, no model field in `AppConfig`, and no
model selector in the UI.

This sub-session adds Ollama discovery, writes Pi's `models.json`, and replaces the
API-key field in Settings with a model picker. The agent still runs on Anthropic at
the end of it — 15.3 does the swap.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: Session 15.1 complete
**Deliverable**: Settings lists the models pulled into the local Ollama daemon and
persists the selection; `~/.keylimepi/pi/models.json` describes them to Pi.

## Objectives

1. Discover locally pulled Ollama models.
2. Generate `~/.keylimepi/pi/models.json` with the right OpenAI-compatibility flags.
3. Replace `AppConfig.anthropicApiKey` with `ollamaBaseUrl` + `ollamaModel`.
4. Delete the `safeStorage` / `.apikey` plumbing.
5. Fix the startup bug where `loadConfig()` is never called.

---

## Task 1: apps/electron/src/main/agent/ollama.ts

Ollama's native `/api/tags` endpoint lists pulled models with metadata; its
OpenAI-compatible surface lives at `/v1`. Pi reads custom providers from
`<agentDir>/models.json`.

Two compatibility flags are mandatory. Ollama's OpenAI-compatible endpoint does not
understand the `developer` role or `reasoning_effort` — Pi's own `models.md` calls this
out for Ollama specifically. Without them, reasoning-capable models fail outright.

```typescript
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** Default Ollama daemon address. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/**
 * A model pulled into the local Ollama instance.
 */
export interface OllamaModel {
  /** Model tag as Ollama reports it, e.g. "qwen3-coder:30b". */
  id: string
  /** Parameter size string from Ollama, e.g. "30.5B". */
  parameterSize?: string
  /** Size on disk in bytes. */
  sizeBytes?: number
}

/**
 * Parameters for {@link writeOllamaModelsFile}.
 */
export interface WriteOllamaModelsFileParams {
  /** Pi agent directory, e.g. `~/.keylimepi/pi`. */
  agentDir: string
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** Models to register with Pi. */
  models: OllamaModel[]
}

/**
 * List the models pulled into the local Ollama daemon.
 * @param baseUrl - Ollama daemon base URL, without the `/v1` suffix
 * @returns The pulled models, or an empty array if the daemon is unreachable
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]>

/**
 * Write `<agentDir>/models.json` describing the Ollama provider to Pi.
 * @param params - Target directory, daemon URL, and models to register
 */
export async function writeOllamaModelsFile(
  params: WriteOllamaModelsFileParams
): Promise<void>
```

Emitted file:

```json
{
  "providers": {
    "ollama": {
      "name": "Ollama (local)",
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsStore": false
      },
      "models": [
        {
          "id": "qwen3-coder:30b",
          "name": "qwen3-coder:30b",
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

`apiKey: "ollama"` is a placeholder. Ollama ignores it, but Pi will not surface a model
as *available* without some configured auth, so a keyless local server needs a dummy
value.

**Tool-calling requirement.** Pi's built-in tools use function calling. A model without
tool support will connect and then fail to act. Document `qwen3-coder`, `llama3.1`+,
`gpt-oss`, and `mistral-nemo` as known-good, and surface the failure clearly rather than
silently.

---

## Task 2: AppConfig in apps/electron/src/main/ipc.ts

Current shape (`ipc.ts:79-83`):

```typescript
interface AppConfig {
  anthropicApiKey?: string
  theme: 'light' | 'dark' | 'system'
  autoCommit: boolean
}
```

Replace with:

```typescript
/**
 * Persisted application configuration, stored at `~/.keylimepi/config.json`.
 */
interface AppConfig {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  ollamaBaseUrl: string
  /** Selected model tag, e.g. "qwen3-coder:30b", or null if none chosen. */
  ollamaModel: string | null
  /** UI colour theme. */
  theme: 'light' | 'dark' | 'system'
  /** Whether agent file writes auto-commit to git. */
  autoCommit: boolean
}
```

Delete, in `loadConfig`/`saveConfig`:

- the `apiKeyPath` constant (`ipc.ts:76`) and the `~/.keylimepi/.apikey` read/write
- both `safeStorage` calls (`ipc.ts:110-112`, `141`)
- `process.env.ANTHROPIC_API_KEY = anthropicApiKey` (`ipc.ts:144`)
- the `safeStorage` import (`ipc.ts:5`)

Unlink a stale `~/.keylimepi/.apikey` on load so the ciphertext does not linger.

There are no secrets left to store, so `.claude/rules/electron-security.md`'s
`safeStorage` requirement no longer has a subject. Record that in the notes rather than
letting it look like the rule was quietly dropped. Keep `ANTHROPIC_API_KEY` in
`BLOCKED_ENV_VARS` (`sources/mcp-client.ts:15`, `apps/runner.ts:15`) — that filters the
*user's* environment before spawning subprocesses, which is unrelated.

**Startup bug.** `loadConfig()` is currently only reachable from the `config:get`
handler (`ipc.ts:536`). Call it from `src/main/index.ts` on `app.whenReady()` so the
selected model is known before the first message.

---

## Task 3: models:list IPC + Settings.tsx

New handler, following the existing validation conventions:

```typescript
ipcMain.handle('models:list', async (): Promise<OllamaModel[]> => {
  const config = await loadConfig()
  return listOllamaModels(config.ollamaBaseUrl)
})
```

Bridge it in `preload/index.ts` and declare it in `renderer/src/types/electron.d.ts`.

In `Settings.tsx`, replace the API-key field (and its `'••••••••••••••••'` masking at
line 52) with:

- a text input for `ollamaBaseUrl`
- a `<select>` of discovered models bound to `ollamaModel`
- an explicit "Ollama is not reachable at `<url>`" state with the
  `ollama serve` / `ollama pull` hint — a fresh install with no daemon running is the
  common first experience and must not look like an app bug

`autoCommit` is already rendered but never read; 15.3 makes it real.

---

## Verification

- [ ] `bun run typecheck:all` passes
- [ ] With `ollama serve` running and a model pulled, Settings lists it
- [ ] Selecting a model writes `ollamaModel` to `~/.keylimepi/config.json`
- [ ] `~/.keylimepi/pi/models.json` exists and lists the same models
- [ ] With Ollama stopped, Settings shows the unreachable state and does not throw
- [ ] `~/.keylimepi/.apikey` is removed and no `safeStorage` call remains in `src/main/`
- [ ] Chat still works (still Anthropic, via an ambient `ANTHROPIC_API_KEY`)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/electron/src/main/agent/ollama.ts` | **New** — discovery + `models.json` generation |
| `apps/electron/src/main/ipc.ts` | **Modified** — `AppConfig`, `models:list`, drop `safeStorage` |
| `apps/electron/src/main/index.ts` | **Modified** — `loadConfig()` on ready |
| `apps/electron/src/preload/index.ts` | **Modified** — `listModels` bridge |
| `apps/electron/src/renderer/src/types/electron.d.ts` | **Modified** — `listModels`, `AppConfig` |
| `apps/electron/src/renderer/src/components/Settings.tsx` | **Modified** — base URL + model picker |

---

## Commit Checkpoint

```bash
bun run typecheck:all && bun run build

git add -A
git commit -m "$(cat <<'EOF'
feat(agent): add Ollama provider discovery and model selection

Generates ~/.keylimepi/pi/models.json from the local Ollama daemon's /api/tags,
with supportsDeveloperRole and supportsReasoningEffort disabled as Ollama's
OpenAI-compatible endpoint requires.

- AppConfig gains ollamaBaseUrl and ollamaModel, loses anthropicApiKey
- safeStorage and ~/.keylimepi/.apikey removed; no secrets left to store
- loadConfig() now runs at startup, not only from the config:get handler
- Settings replaces the API key field with a model picker
EOF
)"
```
