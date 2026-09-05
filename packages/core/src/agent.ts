/**
 * Agent-related type definitions for Pi Taster.
 */

import type { PermissionMode } from './permissions.js'

/**
 * Tool execution result from the agent.
 */
export interface ToolResult {
  /** Tool name that was executed. */
  tool: string
  /** Input parameters. */
  input: Record<string, unknown>
  /** Output content. */
  output: string
  /** Whether execution succeeded. */
  success: boolean
}

/**
 * What the agent is doing when it is not producing tokens.
 */
export interface AgentStatus {
  /** What the agent is doing. */
  kind: AgentStatusKind
  /** One sentence for the user, when there is something worth saying. */
  detail?: string
  /** Retry attempt in progress, 1-indexed. */
  attempt?: number
  /** Retries the policy allows. */
  maxAttempts?: number
}

/**
 * The states the agent passes through between tokens.
 *
 * On a slow local model these are most of the wall-clock time, and Pi already
 * emits every one of them. Rendering them is the difference between a recovery
 * and an apparent hang.
 */
export type AgentStatusKind =
  /** Summarizing history because the context window is nearly full. */
  | 'compacting'
  /** Re-issuing a request the local daemon failed. */
  | 'retrying'
  /** Waiting on the model with nothing yet on the wire — usually prefill. */
  | 'waiting'
  /**
   * Waiting for another workspace's turn to finish.
   *
   * Not one of Pi's — Pi Taster's own, and the reason it is worth a kind of its
   * own is that it looks exactly like `waiting` and means something the user can
   * act on. There is one Ollama daemon and one loaded model, so turns generate
   * one at a time however many workspaces are open; a queue rendered as prefill
   * is a queue nobody can tell from a slow model.
   */
  | 'queued'
  /** Working normally again; clear any status the UI is showing. */
  | 'settled'

/**
 * What the daemon did with the prompt prefix it was sent.
 *
 * Measured, not inferred: Ollama reports `prompt_tokens_details.cached_tokens` and Pi
 * carries it as `Usage.cacheRead`. The verdict compares that against the *previous*
 * request's prompt rather than against this one — a turn appending a large tool result
 * legitimately reuses a smaller share than one appending a sentence, so the fraction
 * would report the healthy case as a degradation.
 */
export type CacheVerdict =
  /** Nothing was reused; the whole prompt was prefilled. */
  | 'cold'
  /** Everything already sent came back. This is the state Pi Taster works to keep. */
  | 'reused'
  /** The prefix shrank because history had been summarized, which is expected. */
  | 'compacted'
  /** The prefix shrank with nothing to explain it — the failure W1 exists to prevent. */
  | 'invalidated'
  /** The daemon reported no cache figure. */
  | 'unknown'

/**
 * What one turn cost.
 *
 * The unit is the turn rather than the request because a turn is what a person waits
 * through: one prompt can become four provider requests, and the interesting number
 * is their sum.
 */
export interface TurnCost {
  /** Provider requests in the turn. */
  requests: number
  /** Prompt tokens sent, prefilled and reused together. */
  promptTokens: number
  /** Prompt tokens the daemon had to prefill. */
  prefilledTokens: number
  /** Tokens generated. */
  outputTokens: number
  /**
   * Of those, the ones spent thinking.
   *
   * **0 on Ollama, always** — its `/v1` emits no `completion_tokens_details`, so Pi's
   * `Usage.reasoning` has nothing to read. A zero here means "not reported", never
   * "no thinking happened".
   */
  reasoningTokens: number
  /** Requests that re-prefilled a prefix they had already sent. */
  rePrefills: number
  /** Wall time from the turn's first request to its last measured moment. */
  elapsedMs: number
}

/**
 * The sampling Pi Taster recommends, by whether the model reasons.
 *
 * Defined here because two places need the same numbers: `agent/sampling.ts` sends
 * them, and Settings tells the user what `Recommended` resolved to. A field labelled
 * "Recommended" that silently means 0.6 on one model and 0 on another is the same
 * class of problem as a control that does nothing — and two copies of the numbers
 * would eventually disagree about which.
 *
 * The split is not a preference. Qwen3 thinking models are documented to degrade and
 * loop under greedy decoding, and `agent/loop-guard.ts` exists to catch exactly that
 * symptom; a model reproducing an `oldText` byte for byte wants the opposite. One
 * number cannot serve both, and Pi Taster shipped one number.
 */
export const RECOMMENDED_SAMPLING = {
  /** Qwen3's documented values for thinking mode. */
  thinking: { temperature: 0.6, topP: 0.95 },
  /** Greedy, with no nucleus cutoff: it is meaningless under greedy decoding. */
  plain: { temperature: 0, topP: null }
} as const

/**
 * Whether the local daemon can answer, and whether it still has the model in memory.
 *
 * Both halves matter and they fail differently. An unreachable daemon fails the next
 * turn immediately; a resident model that has expired costs a full reload — tens of
 * seconds on a 32 GB model — on a turn that otherwise looks ordinary.
 */
export interface DaemonHealth {
  /** Whether the daemon answered at all. */
  reachable: boolean
  /** Whether the selected model is resident, or null when no model is selected. */
  modelLoaded: boolean | null
  /**
   * When the daemon will unload it, epoch ms, or null when it is not resident.
   *
   * A model Pi Taster warmed carries 30 minutes; one loaded by something else carries
   * the daemon's 5-minute default.
   */
  expiresAt: number | null
}

/**
 * What one write changed, as a diff the UI can render.
 *
 * Travels on the tool result's `details`, which never reaches the model — so showing
 * the user what the agent did costs nothing in the context window.
 */
export interface FilePatch {
  /** Path to the changed file, relative to the app root. */
  path: string
  /** The change as a unified diff, ready to render. */
  patch: string
  /** Lines added. */
  added: number
  /** Lines removed. */
  removed: number
  /** Whether the diff was cut short to keep it renderable. */
  truncated: boolean
}

/**
 * A single streamed update from the agent to the renderer.
 *
 * This is the canonical definition. The preload bridge and the renderer's
 * `electron.d.ts` mirror it because a sandboxed preload cannot import from the
 * workspace; keep all three in step.
 */
export interface StreamChunk {
  /** Type of chunk. */
  type:
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'complete'
    | 'error'
    | 'status'
  /** Text content (for 'text' and 'thinking' types). */
  text?: string
  /** Tool name (for 'tool_start' and 'tool_end' types). */
  tool?: string
  /**
   * Stable identifier correlating a 'tool_start' with its 'tool_end'.
   *
   * Required to render parallel tool calls correctly; matching by position
   * mis-associates results when more than one tool runs at a time.
   */
  toolCallId?: string
  /** Tool arguments (for 'tool_start' type). */
  input?: Record<string, unknown>
  /** Truncated tool output (for 'tool_end' type). */
  output?: string
  /** Error message (for 'error' type, or a failed 'tool_end'). */
  error?: string
  /** What the agent is doing (for 'status' type). */
  status?: AgentStatus
  /** What the finished turn cost (for 'complete' type). */
  turn?: TurnCost
  /** What the daemon did with the prefix on the turn's last request. */
  cache?: CacheVerdict
  /**
   * What a write actually changed (for 'tool_end' on a file-modifying tool).
   *
   * Carried out of the tool's `details`, which never reaches the model — so a diff in
   * the transcript costs nothing in the context window.
   */
  patches?: FilePatch[]
}

/**
 * How much of the context window the conversation currently occupies.
 */
export interface ContextUsage {
  /** Tokens the conversation currently occupies. */
  used: number
  /** Tokens the model will actually accept. */
  window: number
}

/**
 * Where the context window number came from.
 *
 * Mirrors `ContextWindowSource` in the main process's `context-budget.ts`. The two
 * are structurally identical on purpose: that module is deliberately free of
 * dependencies, and this one cannot import from `apps/`.
 */
export type ContextWindowSource = 'user' | 'daemon' | 'fallback'

/**
 * Which half of the window a block sits in.
 *
 * The distinction is what the block is worth doing about. `fixed` is paid on every
 * request and shrinks only by changing configuration — turning off a skill, dropping
 * a tool profile, trimming `AGENTS.md`. `conversation` grows with the session and is
 * cleared by compacting or starting a new chat.
 */
export type ContextBlockGroup = 'fixed' | 'conversation'

/**
 * One attributable slice of the context window.
 *
 * Blocks are estimates. Only the total can be measured — it comes from the provider's
 * own usage accounting — so a report's blocks will not sum to its `measured` value and
 * the UI says so rather than scaling them to fit.
 */
export interface ContextBlock {
  /** Stable identifier, used as a React key and to select the block's fill. */
  id: string
  /** Human label, e.g. `Tool results`. */
  label: string
  /** Which half of the bar this belongs to. */
  group: ContextBlockGroup
  /** Estimated tokens this block occupies. */
  tokens: number
  /** Secondary text, e.g. `23 calls` or `4 enabled`. */
  detail?: string
}

/**
 * A single large tool result, named so it can be recognized.
 */
export interface ContextHotspot {
  /** What produced it, e.g. `read src/App.tsx`. */
  label: string
  /** Estimated tokens it occupies. */
  tokens: number
}

/**
 * How confident a {@link ContextReport} is about its own numbers.
 *
 * The meter renders in all four, which is the point: every one of these used to
 * render nothing at all.
 */
export type ContextReportState = 'live' | 'estimated' | 'stale' | 'floor'

/**
 * What the context window is holding, and how much of it is worth acting on.
 *
 * Built by the main process on demand. It never requires a live agent session — the
 * fixed half is a pure function of the app, its skills and its tool profile — which is
 * what lets the meter show a number before the first prompt of a session.
 */
export interface ContextReport {
  /** How much of this report is measured rather than estimated. */
  state: ContextReportState
  /**
   * The provider's own token count for the conversation, when there is one.
   *
   * Null unless {@link state} is `live`: it is absent before the first assistant
   * response and again immediately after every compaction.
   */
  measured: number | null
  /** Sum of {@link blocks}. Always present, always an estimate. */
  estimated: number
  /** Tokens the model will actually accept. */
  window: number
  /** Where {@link window} came from. */
  windowSource: ContextWindowSource
  /** Token count at which the agent stops to summarize. */
  compactAt: number
  /** The attribution, largest first within each group. */
  blocks: ContextBlock[]
  /** The largest individual tool results, descending, at most three. */
  hotspots: ContextHotspot[]
  /**
   * Measured prefill rate in tokens per second, or null before there is a sample.
   *
   * What turns a token count into a *time*. On the audited model a cold prefill of the
   * whole window is about thirteen minutes, and until this was shown the meter could
   * report a comfortable-looking number for a conversation whose next turn would take
   * that long.
   */
  prefillRate: number | null
}

/**
 * Agent query options.
 */
export interface QueryOptions {
  /** The prompt/message to send. */
  prompt: string
  /** Permission mode for this query. */
  permissionMode?: PermissionMode
  /** Session ID for conversation continuity. */
  sessionId?: string
}

/**
 * How a provider request ended.
 */
export type RequestOutcome =
  /** Still in flight. */
  | 'pending'
  /** Finished with usage. */
  | 'ok'
  /** The provider or the model reported a failure. */
  | 'error'
  /** The user stopped the run. */
  | 'aborted'
  /**
   * Closed without usage.
   *
   * Compaction issues its own provider request, which produces both provider hooks
   * and no assistant message. Its timing is real and worth keeping — it is prefill
   * the user waits through — but its tokens are not reported.
   */
  | 'unmeasured'

/**
 * One provider request, as far as it could be measured.
 *
 * Every token field is nullable and every duration is nullable, because a request can
 * end at any point in the sequence that populates them. A record that claimed a zero
 * where it meant "not known" would be averaged into the rates as if it were a
 * measurement, and drawn in a chart as if it were one.
 */
export interface ProviderRequestRecord {
  /** Position in the session, 1-based and never reused. */
  index: number
  /** When the request was handed to the provider, epoch ms. */
  startedAt: number
  /** HTTP status, once the response headers arrived. */
  status: number | null
  /** Request to response headers. On Ollama this is the prefill. */
  prefillMs: number | null
  /** Request to the first content delta. */
  firstTokenMs: number | null
  /** Request to the finished message. */
  totalMs: number | null
  /** Prompt tokens, prefilled and reused together. */
  promptTokens: number | null
  /** Prompt tokens the daemon had to prefill — Pi's `usage.input`. */
  prefilledTokens: number | null
  /** Prompt tokens the daemon reused — Pi's `usage.cacheRead`. */
  cachedTokens: number | null
  /** Tokens generated, reasoning included. */
  outputTokens: number | null
  /**
   * Of those, the ones spent thinking — **which is 0 on Ollama, always**.
   *
   * Pi reads this from `completion_tokens_details.reasoning_tokens`, and Ollama's
   * `/v1` does not emit `completion_tokens_details` at all. It *does* return a
   * populated `reasoning` field on the message, so the model is thinking and the
   * tokens are inside `completion_tokens` — they are simply never broken out. A zero
   * here is "not reported", never "no thinking happened". The field is kept because
   * Pi's `Usage` carries it and a provider that does report it should not need new
   * plumbing.
   */
  reasoningTokens: number | null
  /** What happened to the prefix. */
  cache: CacheVerdict
  /** How the request ended. */
  outcome: RequestOutcome
}

/**
 * Counts that outlive the request ring buffer.
 *
 * The buffer forgets, and the two numbers that settle whether the sealed prefix is
 * holding — how many times a session re-prefilled, and how long it spent doing it —
 * are exactly the ones a long session would forget first.
 */
export interface TelemetryTotals {
  /** Provider requests started. */
  requests: number
  /** Prompt tokens prefilled across the session. */
  prefilledTokens: number
  /** Prompt tokens reused across the session. */
  cachedTokens: number
  /** Tokens generated across the session. */
  outputTokens: number
  /** Of those, the ones spent thinking. 0 on Ollama — see the record's own field. */
  reasoningTokens: number
  /** Wall time spent prefilling. */
  prefillMs: number
  /** Requests whose prefix shrank with no compaction to explain it. */
  invalidations: number
  /** Requests whose prefix shrank because history had been summarized. */
  compactions: number
}

/**
 * A reading of the session's request history.
 *
 * Crosses IPC whole. Its owner in main outlives the agent host, so this can be read
 * without warming a model — which is what lets a panel show it on mount.
 */
export interface TelemetrySnapshot {
  /** The recent requests, oldest first. */
  requests: readonly ProviderRequestRecord[]
  /** Lifetime counts. */
  totals: TelemetryTotals
  /** The turn in progress, or the one that just finished. */
  turn: TurnCost
  /**
   * Measured prefill rate in tokens per second, or null before there is a sample.
   *
   * The median of the recent measurable requests, over `prefilledTokens` rather than
   * the whole prompt — the reused part was never prefilled, and dividing by it would
   * report a rate that rises with the cache rather than a property of the model. A
   * median rather than a mean because a model reload lands in the buffer as one
   * enormous outlier.
   */
  prefillRate: number | null
  /** Measured decode rate in tokens per second, or null before there is a sample. */
  decodeRate: number | null
}
