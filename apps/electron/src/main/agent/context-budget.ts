/**
 * The single source of truth for how much context the agent actually has.
 *
 * Every context-sized number in the app derives from here: what anyapp writes into
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

/** Smallest window the derivation below stays coherent for. */
const MIN_CONTEXT_WINDOW = 2048

/** Largest window anyapp will configure, whatever the daemon claims. */
const MAX_CONTEXT_WINDOW = 262144

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
const TOOL_RESULT_SHARE = 0.06

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

  return {
    window,
    source,
    maxTokens,
    compaction: { enabled: true, reserveTokens, keepRecentTokens },
    maxToolResultTokens: Math.max(256, Math.round(window * TOOL_RESULT_SHARE))
  }
}

/**
 * Describe where a budget's window came from, for the Settings hint.
 * @param budget - The budget to describe
 * @returns One sentence naming the source and the number
 */
export function describeContextWindow(budget: ContextBudget): string {
  const tokens = budget.window.toLocaleString('en-US')
  switch (budget.source) {
    case 'user':
      return `${tokens} tokens, set by you.`
    case 'daemon':
      return `${tokens} tokens, reported by the daemon for the loaded model.`
    case 'fallback':
      return `${tokens} tokens, a conservative default — the daemon did not report one.`
  }
}
