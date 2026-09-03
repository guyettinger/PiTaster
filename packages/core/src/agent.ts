/**
 * Agent-related type definitions for anyapp.
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
  /** Working normally again; clear any status the UI is showing. */
  | 'settled'

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
    | 'rate_limit'
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
  /** Seconds until retry (for 'rate_limit' type). */
  retryAfterSeconds?: number
  /** What the agent is doing (for 'status' type). */
  status?: AgentStatus
  /** Context consumed after this turn, when Pi has reported usage. */
  contextUsage?: ContextUsage
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
