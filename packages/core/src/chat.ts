/**
 * Chat history type definitions for anyapp.
 *
 * These types define the structure of persisted chat messages stored
 * as JSON files in each app's .chat-history/ directory.
 */

/**
 * Serialized text content block.
 */
export interface SerializedTextBlock {
  type: 'text'
  /** The text content. */
  content: string
}

/**
 * Serialized tool execution block.
 */
export interface SerializedToolBlock {
  type: 'tool'
  /** The tool name. */
  name: string
  /** Tool input parameters. */
  input?: Record<string, unknown>
  /** Tool output result. */
  output?: string
  /** Tool execution status. */
  status: 'pending' | 'running' | 'complete' | 'error'
  /** Error message if status is 'error'. */
  error?: string
}

/**
 * Serialized approval record block.
 */
export interface SerializedApprovalBlock {
  type: 'approval'
  /** The tool that was approved/denied. */
  tool: string
  /** Tool input that was shown for approval. */
  input: Record<string, unknown>
  /** Whether the tool was approved. */
  approved: boolean
}

/**
 * Union of all serializable content block types.
 */
export type SerializedContentBlock =
  | SerializedTextBlock
  | SerializedToolBlock
  | SerializedApprovalBlock

/**
 * A persisted chat message.
 */
export interface PersistedMessage {
  /** Unique message ID. */
  id: string
  /** Message role. */
  role: 'user' | 'assistant'
  /** Content blocks. */
  blocks: SerializedContentBlock[]
  /** ISO timestamp when message was created. */
  timestamp: string
}
