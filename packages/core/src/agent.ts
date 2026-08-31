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
 * A single streamed update from the agent to the renderer.
 *
 * This is the canonical definition. The preload bridge and the renderer's
 * `electron.d.ts` mirror it because a sandboxed preload cannot import from the
 * workspace; keep all three in step.
 */
export interface StreamChunk {
  /** Type of chunk. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit' | 'status'
  /** Text content (for 'text' type). */
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
