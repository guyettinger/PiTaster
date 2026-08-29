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
 * A single streamed update from the agent to the renderer.
 *
 * This is the canonical definition. The preload bridge and the renderer's
 * `electron.d.ts` mirror it because a sandboxed preload cannot import from the
 * workspace; keep all three in step.
 */
export interface StreamChunk {
  /** Type of chunk. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit'
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
