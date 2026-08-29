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
  /**
   * Stable identifier for this tool call.
   *
   * Correlates a call with its result, which is what makes a persisted
   * transcript replayable rather than display-only.
   */
  toolCallId?: string
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
 * Element context attached to a message.
 */
export interface ElementContext {
  /** Element info from DOM. */
  element: {
    tag: string
    text: string
    classes: string[]
    id?: string
    selector: string
    xpath: string
    bounds: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  /** Screenshot of the element (base64 data URL). */
  screenshot?: string
  /** Timestamp when element was captured. */
  capturedAt: string
}

/**
 * Serialized element context block.
 */
export interface SerializedElementBlock {
  type: 'element'
  /** The element context data. */
  elementContext: ElementContext
}

/**
 * Union of all serializable content block types.
 */
export type SerializedContentBlock =
  | SerializedTextBlock
  | SerializedToolBlock
  | SerializedApprovalBlock
  | SerializedElementBlock

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

/**
 * A chat session within an app.
 */
export interface ChatSession {
  /** Unique session ID (e.g., "sess_abc123"). */
  id: string
  /** User-facing session title. */
  title: string
  /** ISO timestamp when created. */
  createdAt: string
  /** ISO timestamp when last message was sent/received. */
  updatedAt: string
  /** Number of messages in this session. */
  messageCount: number
}

/**
 * Session manifest stored in .chat-sessions.json per app.
 */
export interface ChatSessionManifest {
  /** The currently active session ID for this app. */
  activeSessionId: string | null
  /** All sessions for this app. */
  sessions: ChatSession[]
}

/**
 * Parameters for creating a new chat session.
 */
export interface CreateChatSessionParams {
  /** Optional title (defaults to "New Chat"). */
  title?: string
}
