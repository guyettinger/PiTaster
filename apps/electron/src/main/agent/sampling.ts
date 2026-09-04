/**
 * What sampling parameters to send, and why they are not all zero.
 *
 * Pi exposes no sampling controls: not in `models.json`, not in `SettingsManager`, not
 * on `createAgentSession`. The `before_provider_request` hook is the only route, which
 * is why this exists at all — see `createSamplingExtension` in `session.ts`.
 *
 * Only the parameters Ollama's OpenAI-compatible endpoint actually maps are here.
 * `top_k`, `min_p` and `repeat_penalty` are Ollama-native `options` with no place in
 * the `/v1` schema; Session 25's audit found them accepted without an error and found
 * no evidence they were honoured. Sending them would be a control that does nothing,
 * which is the defect W3 was about.
 */

import { RECOMMENDED_SAMPLING } from '@pitaster/core'

/**
 * A sampling value as the user configured it.
 *
 * Three states, because two were not enough. A number pins it; `null` sends nothing
 * and leaves the model's own Modelfile default alone; `'auto'` asks Pi Taster to choose
 * from what it knows about the model. `'auto'` is the default because the right value
 * genuinely differs by model — see {@link resolveSampling} — and a single number
 * baked into the config was how Pi Taster came to run every thinking model greedily.
 */
export type SamplingSetting = number | 'auto' | null

/**
 * The parameters to merge into a provider request.
 *
 * A field is absent when nothing should be sent for it, which is not the same as
 * sending zero: `temperature: 0` is greedy decoding, an omitted `temperature` is
 * whatever the Modelfile says.
 */
export interface ResolvedSampling {
  /** Sampling temperature, when one should be sent. */
  temperature?: number
  /** Nucleus sampling cutoff, when one should be sent. */
  topP?: number
}

/** Default for both settings: let Pi Taster choose from the model. */
export const DEFAULT_SAMPLING_TEMPERATURE: SamplingSetting = 'auto'

/** Default nucleus setting. See {@link DEFAULT_SAMPLING_TEMPERATURE}. */
export const DEFAULT_SAMPLING_TOP_P: SamplingSetting = 'auto'

/**
 * Bounds, as the OpenAI-compatible endpoint defines them.
 *
 * Exported because the IPC validator and the Settings fields both bound the user's
 * value, and a bound that disagrees with this one is accepted, persisted, shown back,
 * and then rejected by the daemon — the same reasoning as `MIN_CONTEXT_WINDOW`.
 */
export const MIN_SAMPLING_TEMPERATURE = 0
export const MAX_SAMPLING_TEMPERATURE = 2
export const MIN_SAMPLING_TOP_P = 0
export const MAX_SAMPLING_TOP_P = 1

/**
 * Inputs to {@link resolveSampling}.
 */
export interface ResolveSamplingParams {
  /** Temperature as configured. */
  temperature: SamplingSetting
  /** Nucleus cutoff as configured. */
  topP: SamplingSetting
  /**
   * Whether the model reasons.
   *
   * Read from Pi's `model.reasoning`, which `writeOllamaModelsFile` sets from Ollama's
   * own `thinking` capability — the same flag the reasoning-effort control is gated on,
   * so a model cannot be treated as thinking by one and not the other.
   */
  supportsThinking: boolean
}

/**
 * Decide what to send for one model.
 *
 * The recommendation splits on whether the model reasons, because the two cases want
 * opposite things. A reasoning model asked to decode greedily loops; a model
 * reproducing an exact `oldText` wants no creativity at all. One number cannot serve
 * both, and Pi Taster shipped one number.
 *
 * A pinned value always wins. `'auto'` sends no `top_p` at all — rather than 1 —
 * whenever the temperature in effect is 0, whether that came from the recommendation
 * for a non-reasoning model or from a value the user pinned: greedy decoding makes the
 * nucleus cutoff meaningless, and a parameter sent for no reason is one more thing to
 * be wrong.
 *
 * @param params - The configured values and what is known about the model
 * @returns The parameters to merge into the request
 */
export function resolveSampling(params: ResolveSamplingParams): ResolvedSampling {
  const { temperature, topP, supportsThinking } = params
  const resolved: ResolvedSampling = {}

  if (typeof temperature === 'number') {
    resolved.temperature = temperature
  } else if (temperature === 'auto') {
    resolved.temperature = supportsThinking
      ? RECOMMENDED_SAMPLING.thinking.temperature
      : RECOMMENDED_SAMPLING.plain.temperature
  }

  if (typeof topP === 'number') {
    resolved.topP = topP
  } else if (topP === 'auto' && supportsThinking && resolved.temperature !== 0) {
    // Only when the temperature it would modify is not greedy. A recommendation that
    // pairs a nucleus cutoff with `temperature: 0` is sending a parameter that cannot
    // do anything — and an install carrying Pi Taster's old pinned 0 would have got
    // exactly that pair the moment this field appeared.
    resolved.topP = RECOMMENDED_SAMPLING.thinking.topP
  }

  return resolved
}

/**
 * Whether anything at all needs sending.
 *
 * When nothing does, the extension is not registered rather than registered with an
 * empty payload — a `before_provider_request` handler that returns the payload
 * unchanged still replaces it, and the cheapest way to leave a request alone is not
 * to touch it.
 *
 * @param sampling - The resolved parameters
 * @returns True when at least one parameter should be sent
 */
export function hasSampling(sampling: ResolvedSampling): boolean {
  return sampling.temperature !== undefined || sampling.topP !== undefined
}

/**
 * Describe what `'auto'` resolves to, for the Settings hint.
 *
 * The recommendation is only useful if a person can see what it chose. A field reading
 * "Recommended" that silently means 0.6 on one model and 0 on another is the same
 * class of problem as a setting that does nothing.
 *
 * @param supportsThinking - Whether the selected model reasons
 * @returns One sentence naming the values in effect
 */
export function describeAutoSampling(supportsThinking: boolean): string {
  const { temperature, topP } = supportsThinking
    ? RECOMMENDED_SAMPLING.thinking
    : RECOMMENDED_SAMPLING.plain
  return supportsThinking
    ? `Reasoning model: temperature ${temperature}, top_p ${topP}.`
    : `Not a reasoning model: temperature ${temperature}, no top_p.`
}
