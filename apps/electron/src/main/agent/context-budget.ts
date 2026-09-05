/**
 * The single source of truth for how much context the agent actually has.
 *
 * Every context-sized number in the app derives from here: what Key Lime Pi writes into
 * Pi's `models.json`, the compaction thresholds it hands Pi's `SettingsManager`, and
 * the cap the context trimmer applies to tool results.
 *
 * The problem this solves is that Ollama's advertised context length is not the one
 * it serves. `/api/show` reports the model's architectural maximum — 262144 for
 * `qwen3.8:27b-mlx` — while `/api/ps` reports what the daemon actually loaded, which
 * on that machine is 65536. Pi's `shouldCompact` is
 * `tokens > contextWindow - reserveTokens`, so a window of 262144 means compaction
 * never fires and Ollama silently truncates the head of the prompt instead: no
 * error, no event, and a model that has quietly lost its system prompt and tool
 * schemas. `num_ctx` cannot be set over the OpenAI-compatible `/v1` endpoint, so the
 * real window has to be discovered rather than configured.
 */

/**
 * Window assumed when neither the daemon nor the user says otherwise.
 *
 * Deliberately conservative: under-reporting costs a compaction, over-reporting
 * costs silent truncation.
 */
export const FALLBACK_CONTEXT_WINDOW = 32768

/**
 * Smallest window the derivation below stays coherent for.
 *
 * Exported because the IPC layer and the Settings field both bound the user's
 * override, and a bound that disagrees with this one accepts a number it will then
 * silently clamp.
 */
export const MIN_CONTEXT_WINDOW = 2048

/** Largest window Key Lime Pi will configure, whatever the daemon claims. */
export const MAX_CONTEXT_WINDOW = 262144

/** Share of the window one assistant turn may spend on output. */
const OUTPUT_FRACTION = 0.15

/** Hard bounds on that output allowance. */
const MIN_OUTPUT_TOKENS = 256
const MAX_OUTPUT_TOKENS = 8192

/** Never let one turn's output claim more than this share of the window. */
const MAX_OUTPUT_SHARE = 0.25

/** Headroom above the output allowance for the summarization prompt itself. */
const SUMMARY_PROMPT_TOKENS = 2048

/** Share of the summary prompt allowance, for windows too small for the constant. */
const MAX_SUMMARY_PROMPT_SHARE = 0.1

/** Share of the usable window retained verbatim after a compaction. */
const KEEP_RECENT_FRACTION = 0.35

/** Floor on the retained tail, so compaction never leaves the model with nothing. */
const MIN_KEEP_RECENT_TOKENS = 512

/**
 * Ceiling on `reserveTokens + keepRecentTokens`, as a share of the window.
 *
 * Compaction that reserves more than it can ever free thrashes: it summarizes, finds
 * itself still over the threshold, and summarizes again. Keeping the two below this
 * share guarantees a compaction actually makes room.
 */
const SETTINGS_CEILING_SHARE = 0.9

/** Share of the window a single tool result may occupy before it is truncated. */
const TOOL_RESULT_SHARE = 0.2

/**
 * Ceiling on that share, in tokens.
 *
 * Pi's `read` already caps its own output at 50 KB or 2000 lines, whichever comes
 * first, and its description tells the model to page through a large file with
 * `offset`. A trimmer cap below that ceiling fights the read tool: every full read
 * arrives legal and is then cut, and because Pi's output carries no line numbers the
 * agent cannot tell how much it lost. So one result is allowed Pi's whole 50 KB —
 * roughly 12.8k tokens — wherever the window can afford it. On a window too small for
 * that, {@link TOOL_RESULT_SHARE} governs and truncation is unavoidable.
 */
const PI_READ_MAX_TOKENS = Math.floor((50 * 1024) / 4)

/**
 * Share of the window one tool result may occupy even inside the current turn.
 *
 * The other half is the system prompt, the tool schemas, and the history that makes
 * the result mean anything. A result past this cannot coexist with them, so the
 * request fails whatever we do — and it fails as an unexplained timeout rather than
 * as an oversized tool result.
 */
const HARD_TOOL_RESULT_SHARE = 0.5

/**
 * Share of the window carried as untrimmed recent history before the seal advances.
 *
 * The seal is what makes the prompt prefix stable, and advancing it costs one cold
 * prefill of the whole prompt — 133.5s on the audited model. Advancing too eagerly
 * pays that repeatedly; advancing too rarely carries this much untrimmed history in
 * every request meanwhile. A quarter of the window puts the advance several turns
 * apart on the windows Key Lime Pi targets, against the previous design's every turn.
 */
const SEAL_ADVANCE_SHARE = 0.25

/**
 * Floor on that, so a small window still batches its seals.
 *
 * Bounded below by {@link CompactionThresholds.keepRecentTokens} at the point of use:
 * history compaction is about to summarize away is history not worth sealing.
 */
const MIN_SEAL_ADVANCE_TOKENS = 1024

/** Where the effective context window came from. */
export type ContextWindowSource = 'user' | 'daemon' | 'fallback'

/**
 * Compaction thresholds in the shape Pi's `SettingsManager` expects.
 *
 * Pi's own `DEFAULT_COMPACTION_SETTINGS` is `reserveTokens: 16384` and
 * `keepRecentTokens: 20000`, sized for a frontier window. On anything smaller those
 * two numbers alone exceed the budget.
 */
export interface CompactionThresholds {
  /** Auto-compaction is always on; the thresholds are what vary. */
  enabled: true
  /** Tokens kept free for the summarization prompt and its output. */
  reserveTokens: number
  /** Approximate tokens of recent history retained verbatim after compaction. */
  keepRecentTokens: number
}

/**
 * Everything derived from one model's effective context window.
 */
export interface ContextBudget {
  /** Tokens the daemon will actually serve. */
  window: number
  /** Where {@link window} came from, so Settings can explain the number it shows. */
  source: ContextWindowSource
  /** Cap on one assistant turn's output. */
  maxTokens: number
  /** Compaction thresholds scaled to {@link window}. */
  compaction: CompactionThresholds
  /** Size above which the context trimmer truncates a single tool result. */
  maxToolResultTokens: number
  /**
   * Size above which a tool result is truncated even inside the current turn.
   *
   * Half the window: past that a single result cannot coexist with the system prompt,
   * the tool schemas and the history that gives it meaning, so the request is doomed
   * either way. That is a different judgement from {@link maxToolResultTokens}, which
   * only asks whether a result still earns its space — and the current turn is
   * deliberately exempt from that one, because an agent that cannot see what it just
   * did repeats it.
   */
  hardToolResultTokens: number
  /**
   * Tokens of new, untrimmed history carried before the context seal advances.
   *
   * See `agent/context-trim.ts`: the seal is the one moment Key Lime Pi deliberately
   * invalidates the daemon's prefix cache, and this is how much it lets accumulate
   * before deciding that is worth doing.
   */
  sealAdvanceTokens: number
}

/**
 * Inputs to {@link deriveContextBudget}.
 */
export interface DeriveContextBudgetParams {
  /** The user's explicit override from Settings, when they set one. */
  userOverride?: number | null
  /** Context length the daemon reports for the loaded model, via `/api/ps`. */
  daemonWindow?: number | null
  /** Context length the model's metadata advertises, via `/api/show`. */
  advertisedWindow?: number | null
}

/**
 * Clamp a candidate window into the range the derivation is defined for.
 * @param value - The candidate window in tokens
 * @returns The clamped window
 */
function clampWindow(value: number): number {
  return Math.min(MAX_CONTEXT_WINDOW, Math.max(MIN_CONTEXT_WINDOW, Math.floor(value)))
}

/**
 * Whether a discovered window is usable as a number of tokens.
 * @param value - The value to test
 * @returns True when it is a finite, positive number
 */
function isUsableWindow(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Resolve the effective context window and where it came from.
 *
 * The user wins, then the daemon, then the model's advertised maximum capped at
 * {@link FALLBACK_CONTEXT_WINDOW} — because an advertised 262144 is exactly the
 * number that causes silent truncation, and a small model's honest 8192 should still
 * be believed.
 *
 * @param params - The candidate windows
 * @returns The window and its provenance
 */
function resolveWindow(params: DeriveContextBudgetParams): {
  window: number
  source: ContextWindowSource
} {
  if (isUsableWindow(params.userOverride)) {
    return { window: clampWindow(params.userOverride), source: 'user' }
  }
  if (isUsableWindow(params.daemonWindow)) {
    return { window: clampWindow(params.daemonWindow), source: 'daemon' }
  }
  if (isUsableWindow(params.advertisedWindow)) {
    return {
      window: clampWindow(Math.min(params.advertisedWindow, FALLBACK_CONTEXT_WINDOW)),
      source: 'fallback'
    }
  }
  return { window: FALLBACK_CONTEXT_WINDOW, source: 'fallback' }
}

/**
 * Derive every context-sized setting from the effective window.
 *
 * The derivation is written so that
 * `reserveTokens + keepRecentTokens < window * 0.9` holds for every window in
 * range — the invariant that keeps compaction from thrashing. It is enforced by
 * construction and covered by tests, not asserted at runtime.
 *
 * @param params - The candidate windows
 * @returns The budget for this model
 */
export function deriveContextBudget(params: DeriveContextBudgetParams = {}): ContextBudget {
  const { window, source } = resolveWindow(params)

  const maxTokens = Math.min(
    Math.floor(window * MAX_OUTPUT_SHARE),
    Math.min(
      MAX_OUTPUT_TOKENS,
      Math.max(MIN_OUTPUT_TOKENS, Math.round(window * OUTPUT_FRACTION))
    )
  )

  const summaryPrompt = Math.min(
    SUMMARY_PROMPT_TOKENS,
    Math.floor(window * MAX_SUMMARY_PROMPT_SHARE)
  )
  const reserveTokens = maxTokens + summaryPrompt

  const ceiling = Math.floor(window * SETTINGS_CEILING_SHARE)
  const keepRecentTokens = Math.min(
    Math.max(MIN_KEEP_RECENT_TOKENS, Math.round((window - reserveTokens) * KEEP_RECENT_FRACTION)),
    ceiling - reserveTokens
  )

  const maxToolResultTokens = Math.min(
    PI_READ_MAX_TOKENS,
    Math.max(256, Math.round(window * TOOL_RESULT_SHARE))
  )

  return {
    window,
    source,
    maxTokens,
    compaction: { enabled: true, reserveTokens, keepRecentTokens },
    maxToolResultTokens,
    // Never below the ordinary cap: the current turn is exempt from that one, so a
    // hard cap under it would trim the turn more aggressively than the history.
    hardToolResultTokens: Math.max(maxToolResultTokens, Math.floor(window * HARD_TOOL_RESULT_SHARE)),
    // Never above what compaction keeps. History past that is summarized away, so
    // sealing it buys a cache invalidation for bytes that are about to disappear.
    sealAdvanceTokens: Math.min(
      keepRecentTokens,
      Math.max(MIN_SEAL_ADVANCE_TOKENS, Math.floor(window * SEAL_ADVANCE_SHARE))
    )
  }
}
