/**
 * Ollama provider discovery and Pi model configuration.
 *
 * anyapp runs entirely on models served by a local Ollama daemon. Pi reads custom
 * providers from `<agentDir>/models.json`, so this module discovers what the daemon
 * has pulled and writes that file.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** Default address of the local Ollama daemon, without the `/v1` suffix. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/** How long to wait on the Ollama daemon before treating it as unreachable. */
const DISCOVERY_TIMEOUT_MS = 5000

/**
 * Fallback context window for models whose metadata Ollama does not report.
 * Pi's own default is 128k; matching it keeps behaviour predictable.
 */
const DEFAULT_CONTEXT_WINDOW = 128000

/** Fallback maximum output tokens. */
const DEFAULT_MAX_TOKENS = 16384

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
  /** Context window in tokens, from the model's own metadata when available. */
  contextWindow: number
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
  /** Pi agent directory, for example `~/.anyapp/pi`. */
  agentDir: string
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** Models to register with Pi. */
  models: OllamaModel[]
}

/**
 * Parameters for {@link syncOllamaModels}.
 */
export interface SyncOllamaModelsParams {
  /** Pi agent directory, for example `~/.anyapp/pi`. */
  agentDir: string
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
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
): Promise<Pick<OllamaModel, 'contextWindow' | 'supportsTools' | 'supportsVision' | 'supportsThinking'>> {
  const fallback = {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
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
    let contextWindow = DEFAULT_CONTEXT_WINDOW
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
 * @param baseUrl - Ollama daemon base URL, without the `/v1` suffix
 * @returns The pulled chat models, or an empty array if the daemon is unreachable
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const normalized = normalizeOllamaBaseUrl(baseUrl)

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

  const described = await Promise.all(
    entries.map(async (entry): Promise<OllamaModel | null> => {
      const id = typeof entry.name === 'string' ? entry.name : entry.model
      if (typeof id !== 'string' || id.length === 0) return null

      const capabilities = await describeModel(normalized, id)

      return {
        id,
        parameterSize:
          typeof entry.details?.parameter_size === 'string'
            ? entry.details.parameter_size
            : undefined,
        sizeBytes: typeof entry.size === 'number' ? entry.size : undefined,
        ...capabilities
      }
    })
  )

  return described
    .filter((model): model is OllamaModel => model !== null)
    // Embedding-only models report no tool support and cannot complete a chat turn.
    .filter((model) => model.supportsTools || model.supportsVision || model.supportsThinking)
    .sort((a, b) => a.id.localeCompare(b.id))
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
 * Two compatibility flags are mandatory: Ollama's OpenAI-compatible endpoint does not
 * understand the `developer` role or `reasoning_effort`, and reasoning-capable models
 * fail outright without them.
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
          supportsReasoningEffort: false,
          supportsStore: false
        },
        models: models.map((model) => ({
          id: model.id,
          name: model.parameterSize ? `${model.id} (${model.parameterSize})` : model.id,
          input: model.supportsVision ? ['text', 'image'] : ['text'],
          reasoning: model.supportsThinking,
          contextWindow: model.contextWindow,
          maxTokens: DEFAULT_MAX_TOKENS,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }))
      }
    }
  }

  await fs.mkdir(agentDir, { recursive: true })
  await fs.writeFile(
    join(agentDir, 'models.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf-8'
  )
}

/**
 * Discover the local Ollama models and write Pi's `models.json` in one step.
 * @param params - Agent directory and daemon base URL
 * @returns The discovered models
 */
export async function syncOllamaModels(params: SyncOllamaModelsParams): Promise<OllamaModel[]> {
  const models = await listOllamaModels(params.baseUrl)
  await writeOllamaModelsFile({ ...params, models })
  return models
}
