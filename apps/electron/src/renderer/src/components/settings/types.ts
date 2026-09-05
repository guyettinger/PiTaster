import type { SamplingSetting } from '../../types/electron'

/**
 * Application configuration.
 */
export interface AppConfig {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  ollamaBaseUrl: string
  /** Selected model tag, for example `qwen3-coder:30b`, or null when none is chosen. */
  ollamaModel: string | null
  /** UI theme preference. */
  theme: 'light' | 'dark' | 'system'
  /** Whether to auto-commit file changes. */
  autoCommit: boolean
  /** Whether a new chat is named by the local model after its first turn. */
  autoTitleChats: boolean
  /** Context window to configure for the selected model, or null to discover it. */
  contextWindow: number | null
  /** Which tools the agent exposes; 'auto' picks from the context window. */
  toolProfile: 'auto' | 'lean' | 'full'
  /** Whether to shape the context sent to the model. */
  trimContext: boolean
  /** Sampling temperature for the model, or null for the model's own default. */
  samplingTemperature: SamplingSetting
  /** Nucleus cutoff, in the same three states as {@link samplingTemperature}. */
  samplingTopP: SamplingSetting
  /** How hard to ask the model to think; `unset` sends no `reasoning_effort`. */
  reasoningLevel: 'unset' | 'low' | 'medium' | 'high'
}

/**
 * A model pulled into the local Ollama instance.
 */
export interface OllamaModel {
  /** Model tag as Ollama reports it. */
  id: string
  /** Parameter size string reported by Ollama, for example `30.5B`. */
  parameterSize?: string
  /** Context window the model's metadata advertises: its architectural maximum. */
  contextWindow: number
  /** The window Pi Taster actually configures, probed from the daemon when it can be. */
  effectiveContextWindow: number
  /** Where the effective window came from. */
  contextWindowSource: 'user' | 'daemon' | 'fallback'
  /** Whether the model supports function calling. The agent's tools require it. */
  supportsTools: boolean
  /** Whether the model advertises Ollama's `thinking` capability. */
  supportsThinking: boolean
}

/** Default configuration used before the persisted one loads. */
export const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: null,
  theme: 'dark',
  autoCommit: true,
  autoTitleChats: true,
  contextWindow: null,
  toolProfile: 'auto',
  trimContext: true,
  samplingTemperature: 'auto',
  samplingTopP: 'auto',
  reasoningLevel: 'unset'
}
