/**
 * Ollama provider discovery and Pi model configuration.
 *
 * Pi Taster runs entirely on models served by a local Ollama daemon. Pi reads custom
 * providers from `<agentDir>/models.json`, so this module discovers what the daemon
 * has pulled and writes that file.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DaemonHealth } from '@pitaster/core'
import { deriveContextBudget, type ContextBudget, type ContextWindowSource } from './context-budget'

/** Default address of the local Ollama daemon, without the `/v1` suffix. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/** How long to wait on the Ollama daemon before treating it as unreachable. */
const DISCOVERY_TIMEOUT_MS = 5000

/**
 * How long to wait for a model to load into memory.
 *
 * A 27B model on Apple Silicon takes tens of seconds to page in. This is the one
 * Ollama call Pi Taster makes that is expected to be slow.
 */
const WARM_TIMEOUT_MS = 180_000

/** How long to keep a warmed model resident, in Ollama's own duration syntax. */
const WARM_KEEP_ALIVE = '30m'

/** Sentinel for a context length Ollama did not report. */
const UNKNOWN_CONTEXT_WINDOW = 0

/**
 * A model pulled into the local Ollama instance.
 */
export interface OllamaModel {
  /** Model tag as Ollama reports it, for example `qwen3-coder:30b`. */
  id: string
  /** Parameter size string reported by Ollama, for example `30.5B`. */
  parameterSize?: string
  /** Size on disk in bytes. */
  sizeBytes?: number
  /**
   * Context window the model's metadata advertises, or 0 when Ollama reports none.
   *
   * This is the model's *architectural maximum*, not what the daemon serves. Do not
   * hand it to Pi — see {@link effectiveContextWindow}.
   */
  contextWindow: number
  /** The window Pi Taster actually configures, from {@link deriveContextBudget}. */
  effectiveContextWindow: number
  /** Where {@link effectiveContextWindow} came from. */
  contextWindowSource: ContextWindowSource
  /**
   * Whether the model supports function calling.
   *
   * Pi's built-in tools require it. A model without it will connect and then fail to
   * act, so the UI must not offer it as a choice.
   */
  supportsTools: boolean
  /** Whether the model accepts image input. */
  supportsVision: boolean
  /** Whether the model exposes extended thinking. */
  supportsThinking: boolean
}

/**
 * Shape of a single entry in Ollama's `/api/tags` response.
 */
interface OllamaTagEntry {
  /** Model tag. */
  name?: unknown
  /** Model identifier, present on newer daemons. */
  model?: unknown
  /** Size on disk in bytes. */
  size?: unknown
  /** Nested model metadata. */
  details?: { parameter_size?: unknown }
}

/**
 * The subset of Ollama's `/api/show` response that matters here.
 */
interface OllamaShowResponse {
  /** Capability tags such as `completion`, `tools`, `vision`, `thinking`, `embedding`. */
  capabilities?: unknown
  /** Architecture-prefixed metadata, including `<arch>.context_length`. */
  model_info?: Record<string, unknown>
}

/**
 * Parameters for {@link writeOllamaModelsFile}.
 */
export interface WriteOllamaModelsFileParams {
  /** Pi agent directory, for example `~/.pitaster/pi`. */
  agentDir: string
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** Models to register with Pi, each carrying its resolved effective window. */
  models: OllamaModel[]
}

/**
 * Parameters for {@link syncOllamaModels}.
 */
export interface SyncOllamaModelsParams {
  /** Pi agent directory, for example `~/.pitaster/pi`. */
  agentDir: string
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** The model the user selected, whose loaded window is probed. */
  selectedModel?: string | null
  /** The user's context-window override from Settings, when they set one. */
  contextWindowOverride?: number | null
}

/**
 * Parameters for {@link listOllamaModels}.
 */
export interface ListOllamaModelsParams {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** The model the user selected, whose loaded window is probed. */
  selectedModel?: string | null
  /** The user's context-window override from Settings, when they set one. */
  contextWindowOverride?: number | null
  /**
   * The selected model's loaded window, when the caller has already read it.
   *
   * `/api/ps` is a probe, and a session start used to run it twice: once in
   * {@link prepareModelForSession} and again in here, for the same model, moments
   * apart. Passing the first answer in is how the second call is avoided without
   * either caller having to know about the other's timing.
   */
  daemonWindow?: number | null
}

/**
 * Concurrent `/api/show` requests while describing the pulled models.
 *
 * The listing used to fan out one request per model at once, so a machine with thirty
 * models opened Settings by hitting a single local daemon with thirty simultaneous
 * requests — each of which Ollama answers by reading a manifest off disk. Four is
 * enough to hide the round trips without making the daemon queue.
 */
const DESCRIBE_CONCURRENCY = 4

/**
 * Map over items with a bounded number in flight.
 *
 * Order is preserved, so the caller can still pair results with inputs by index.
 *
 * @param items - The inputs
 * @param limit - Maximum concurrent calls
 * @param run - The per-item work
 * @returns The results, in the input's order
 */
async function mapWithLimit<In, Out>(
  items: In[],
  limit: number,
  run: (item: In) => Promise<Out>
): Promise<Out[]> {
  const results = new Array<Out>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Normalize a user-supplied base URL by trimming whitespace and trailing slashes.
 * @param baseUrl - The configured Ollama base URL
 * @returns The normalized URL, or the default when the input is empty
 */
export function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : DEFAULT_OLLAMA_BASE_URL
}

/**
 * Read a model's capabilities and context window from Ollama's `/api/show`.
 * @param baseUrl - Normalized Ollama base URL
 * @param id - Model tag to describe
 * @returns The capability flags and context window, with conservative fallbacks
 */
async function describeModel(
  baseUrl: string,
  id: string
): Promise<
  Pick<OllamaModel, 'contextWindow' | 'supportsTools' | 'supportsVision' | 'supportsThinking'>
> {
  const fallback = {
    contextWindow: UNKNOWN_CONTEXT_WINDOW,
    supportsTools: false,
    supportsVision: false,
    supportsThinking: false
  }

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: id }),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) return fallback

    const payload = (await response.json()) as OllamaShowResponse
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.filter((c): c is string => typeof c === 'string')
      : []

    // Ollama namespaces context length by architecture, e.g. `qwen3_5.context_length`.
    let contextWindow = UNKNOWN_CONTEXT_WINDOW
    for (const [key, value] of Object.entries(payload.model_info ?? {})) {
      if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
        contextWindow = value
        break
      }
    }

    return {
      contextWindow,
      supportsTools: capabilities.includes('tools'),
      supportsVision: capabilities.includes('vision'),
      supportsThinking: capabilities.includes('thinking')
    }
  } catch {
    return fallback
  }
}

/**
 * List the chat-capable models pulled into the local Ollama daemon.
 *
 * Ollama's native `/api/tags` endpoint carries richer metadata than the
 * OpenAI-compatible `/v1/models` listing, and `/api/show` reports per-model
 * capabilities. Embedding-only models are excluded — they cannot drive an agent.
 *
 * The selected model's entry also carries the window Pi Taster will actually configure,
 * resolved from the user's override, the daemon's loaded context length, and the
 * advertised maximum — in that order.
 *
 * @param params - Daemon URL, the selected model, and any user override
 * @returns The pulled chat models, or an empty array if the daemon is unreachable
 */
export async function listOllamaModels(params: ListOllamaModelsParams): Promise<OllamaModel[]> {
  const { baseUrl, selectedModel, contextWindowOverride } = params
  const normalized = normalizeOllamaBaseUrl(baseUrl)

  // Only the selected model is worth probing: `/api/ps` answers for loaded models,
  // and loading every pulled model to ask would be absurd. A caller that has just
  // warmed the model has already asked, and passes the answer in.
  const daemonWindow =
    params.daemonWindow !== undefined
      ? params.daemonWindow
      : selectedModel
        ? await getLoadedContextLength({ baseUrl: normalized, modelId: selectedModel })
        : null

  let entries: OllamaTagEntry[]
  try {
    const response = await fetch(`${normalized}/api/tags`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) return []

    const payload = (await response.json()) as { models?: unknown }
    if (!Array.isArray(payload.models)) return []
    entries = payload.models as OllamaTagEntry[]
  } catch {
    // An unreachable daemon is an expected state, not an error. Callers render it.
    return []
  }

  const described = await mapWithLimit(
    entries,
    DESCRIBE_CONCURRENCY,
    async (entry): Promise<OllamaModel | null> => {
      const id = typeof entry.name === 'string' ? entry.name : entry.model
      if (typeof id !== 'string' || id.length === 0) return null

      const capabilities = await describeModel(normalized, id)
      const isSelected = id === selectedModel
      const budget = deriveContextBudget({
        userOverride: isSelected ? contextWindowOverride : null,
        daemonWindow: isSelected ? daemonWindow : null,
        advertisedWindow: capabilities.contextWindow
      })

      return {
        id,
        parameterSize:
          typeof entry.details?.parameter_size === 'string'
            ? entry.details.parameter_size
            : undefined,
        sizeBytes: typeof entry.size === 'number' ? entry.size : undefined,
        ...capabilities,
        effectiveContextWindow: budget.window,
        contextWindowSource: budget.source
      }
    }
  )

  return described
    .filter((model): model is OllamaModel => model !== null)
    // Embedding-only models report no tool support and cannot complete a chat turn.
    .filter((model) => model.supportsTools || model.supportsVision || model.supportsThinking)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Parameters for {@link getLoadedContextLength} and {@link warmModel}.
 */
export interface LoadedModelParams {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** Model tag to ask about. */
  modelId: string
}

/**
 * Shape of a single entry in Ollama's `/api/ps` response.
 */
interface OllamaRunningEntry {
  /** Model tag. */
  name?: unknown
  /** Model identifier. */
  model?: unknown
  /** Context length the daemon actually loaded this model with. */
  context_length?: unknown
  /** ISO timestamp at which the daemon will unload this model. */
  expires_at?: unknown
}

/**
 * Read the context length the daemon actually loaded a model with.
 *
 * This is the number that matters and the only place Ollama publishes it.
 * `/api/show` reports the model's architectural maximum instead — 262144 against a
 * served 65536 on the reference machine — and `num_ctx` cannot be set over the
 * OpenAI-compatible endpoint, so this is discovery, not configuration.
 *
 * Answers only while the model is resident; call {@link warmModel} first if that
 * matters. An unloaded model, an old daemon, or an unreachable one all return null,
 * which leaves the budget on its conservative default.
 *
 * @param params - Daemon URL and model tag
 * @returns The loaded context length in tokens, or null when it cannot be read
 */
export async function getLoadedContextLength(
  params: LoadedModelParams
): Promise<number | null> {
  const { baseUrl, modelId } = params

  try {
    const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/ps`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) return null

    const payload = (await response.json()) as { models?: unknown }
    if (!Array.isArray(payload.models)) return null

    for (const entry of payload.models as OllamaRunningEntry[]) {
      const id = typeof entry.name === 'string' ? entry.name : entry.model
      if (id !== modelId) continue
      return typeof entry.context_length === 'number' && entry.context_length > 0
        ? entry.context_length
        : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Load a model into memory without asking it for anything.
 *
 * Two reasons to do this before the first prompt: it makes the model's real context
 * length readable from `/api/ps`, and it moves the tens of seconds a large local
 * model spends paging in out of the user's first message, where it looks like a hang.
 *
 * Failure is not fatal — the agent will simply load the model on its first request,
 * as it did before.
 *
 * @param params - Daemon URL and model tag
 * @returns True when the daemon reported the model loaded
 */
export async function warmModel(params: LoadedModelParams): Promise<boolean> {
  const { baseUrl, modelId } = params

  try {
    const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // An empty prompt is Ollama's documented way to load a model and return.
      body: JSON.stringify({ model: modelId, prompt: '', keep_alive: WARM_KEEP_ALIVE }),
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Read whether the daemon is answering and whether it still holds the model.
 *
 * One request, because both answers come from `/api/ps`: a response at all proves the
 * daemon is up, and the entry for the selected model — if there is one — carries the
 * `expires_at` after which it is unloaded.
 *
 * That second number is worth surfacing because its cost is invisible until it is
 * paid. `warmModel` asks for 30 minutes, but a model loaded by anything else carries
 * the daemon's 5-minute default, and the first turn after an unload pays a full
 * reload of a 32 GB model on top of its prefill — indistinguishable, from the outside,
 * from a turn that simply hung.
 *
 * @param params - Daemon URL and the selected model, if any
 * @returns The daemon's health; never throws
 */
export async function readDaemonHealth(params: {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** The selected model tag, or null when none is chosen. */
  modelId: string | null
}): Promise<DaemonHealth> {
  const { baseUrl, modelId } = params
  const unreachable: DaemonHealth = { reachable: false, modelLoaded: null, expiresAt: null }

  try {
    const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/ps`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) return unreachable

    const payload = (await response.json()) as { models?: unknown }
    if (modelId === null) return { reachable: true, modelLoaded: null, expiresAt: null }
    if (!Array.isArray(payload.models)) {
      return { reachable: true, modelLoaded: false, expiresAt: null }
    }

    for (const entry of payload.models as OllamaRunningEntry[]) {
      const id = typeof entry.name === 'string' ? entry.name : entry.model
      if (id !== modelId) continue
      const expires =
        typeof entry.expires_at === 'string' ? Date.parse(entry.expires_at) : Number.NaN
      return {
        reachable: true,
        modelLoaded: true,
        expiresAt: Number.isFinite(expires) ? expires : null
      }
    }
    return { reachable: true, modelLoaded: false, expiresAt: null }
  } catch {
    return unreachable
  }
}

/**
 * Check whether the Ollama daemon is reachable.
 * @param baseUrl - Ollama daemon base URL, without the `/v1` suffix
 * @returns True when the daemon answered
 */
export async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/version`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Write `<agentDir>/models.json` describing the Ollama provider to Pi.
 *
 * `supportsDeveloperRole` and `supportsStore` are off because Ollama's
 * OpenAI-compatible endpoint does not understand either, and a reasoning-capable model
 * fails outright with them.
 *
 * `supportsReasoningEffort` was off for the same stated reason and should not have
 * been. Session 25's audit sent the parameter directly: `low`, `medium` and `high`
 * are all accepted, and `low` and `high` measurably change both the prompt token
 * count — so the daemon injects something into the template — and the length of the
 * reasoning produced. `medium` is byte-identical to sending nothing. Disabling the
 * flag stripped the one working control Pi Taster had over how long a model thinks.
 *
 * What it does *not* buy is an off switch. With `thinkingLevel: 'off'` Pi sends no
 * `reasoning_effort` at all, and the audit found the models reasoning on every
 * request regardless. Ollama's native `think: false` works, but that is `/api/chat`,
 * not the `/v1` path Pi uses.
 *
 * @param params - Target directory, daemon URL, and models to register
 */
export async function writeOllamaModelsFile(
  params: WriteOllamaModelsFileParams
): Promise<void> {
  const { agentDir, baseUrl, models } = params

  const config = {
    providers: {
      ollama: {
        name: 'Ollama (local)',
        baseUrl: `${normalizeOllamaBaseUrl(baseUrl)}/v1`,
        api: 'openai-completions',
        // Ollama ignores the key, but Pi will not surface a model as available
        // without some configured auth, so a keyless server needs a placeholder.
        apiKey: 'ollama',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          supportsStore: false
        },
        models: models.map((model) => {
          // Pi sizes compaction off `contextWindow`, so this must be what the daemon
          // serves, never the architectural maximum `/api/show` advertises.
          const budget = deriveContextBudget({ userOverride: model.effectiveContextWindow })
          return {
            id: model.id,
            name: model.parameterSize ? `${model.id} (${model.parameterSize})` : model.id,
            input: model.supportsVision ? ['text', 'image'] : ['text'],
            reasoning: model.supportsThinking,
            contextWindow: budget.window,
            maxTokens: budget.maxTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          }
        })
      }
    }
  }

  await fs.mkdir(agentDir, { recursive: true })
  const modelsPath = join(agentDir, 'models.json')

  // Merge rather than clobber. Pi Taster owns the `ollama` provider and nothing else in
  // this file, so a provider a user added by hand — or one a future Pi Taster writes —
  // must survive a re-sync, which happens on every config save and every session
  // start. An unreadable or malformed file is replaced, because a file Pi cannot parse
  // is worse than one Pi Taster overwrote.
  let existing: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(modelsPath, 'utf-8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {
    // No file yet, or one that is not JSON. Either way there is nothing to preserve.
  }

  const existingProviders =
    typeof existing.providers === 'object' &&
    existing.providers !== null &&
    !Array.isArray(existing.providers)
      ? (existing.providers as Record<string, unknown>)
      : {}

  const merged = {
    ...existing,
    providers: { ...existingProviders, ...config.providers }
  }

  await fs.writeFile(modelsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
}

/**
 * Discover the local Ollama models and write Pi's `models.json` in one step.
 *
 * This does not warm anything: opening Settings should not page a 20GB model into
 * memory. The selected model's window is read from `/api/ps` if it happens to be
 * resident, and falls back to the conservative default otherwise. Call
 * {@link warmModel} and re-sync when a session is about to start, which is the point
 * at which loading it is what the user asked for anyway.
 *
 * @param params - Agent directory, daemon URL, selected model, and any user override
 * @returns The discovered models, each carrying its effective context window
 */
export async function syncOllamaModels(
  params: SyncOllamaModelsParams & { daemonWindow?: number | null }
): Promise<OllamaModel[]> {
  const models = await listOllamaModels({
    baseUrl: params.baseUrl,
    selectedModel: params.selectedModel,
    contextWindowOverride: params.contextWindowOverride,
    daemonWindow: params.daemonWindow
  })
  await writeOllamaModelsFile({ agentDir: params.agentDir, baseUrl: params.baseUrl, models })
  return models
}

/**
 * Load the selected model, then re-sync Pi's catalog with the window it really got.
 *
 * The order matters: `/api/ps` only answers for a resident model, so warming has to
 * happen before the probe, and `models.json` has to be rewritten before Pi's
 * `ModelRuntime` reads it.
 *
 * @param params - Agent directory, daemon URL, selected model, and any user override
 * @returns The budget Pi Taster configured for the selected model
 */
export async function prepareModelForSession(
  params: SyncOllamaModelsParams & { selectedModel: string }
): Promise<ContextBudget> {
  await warmModel({ baseUrl: params.baseUrl, modelId: params.selectedModel })

  const daemonWindow = await getLoadedContextLength({
    baseUrl: params.baseUrl,
    modelId: params.selectedModel
  })
  // Handed on rather than re-probed: the listing would otherwise ask `/api/ps` the
  // same question about the same model a moment later.
  const models = await syncOllamaModels({ ...params, daemonWindow })
  const selected = models.find((model) => model.id === params.selectedModel)

  // Derived from the raw inputs rather than from the already-resolved window, so the
  // returned budget reports where its number actually came from.
  return deriveContextBudget({
    userOverride: params.contextWindowOverride,
    daemonWindow,
    advertisedWindow: selected?.contextWindow
  })
}
