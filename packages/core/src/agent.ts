/**
 * Agent-related type definitions for CLIRabbit.
 */

import type { PermissionMode } from './permissions'

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
 * Stream chunk from agent response.
 */
export interface StreamChunk {
  /** Type of chunk. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  /** Text content (for 'text' type). */
  text?: string
  /** Tool name (for 'tool_start' type). */
  tool?: string
  /** Error message (for 'error' type). */
  error?: string
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
