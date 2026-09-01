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
 * A session's transcript, tagged with the session it belongs to.
 *
 * The tag is what makes loading a chat correct rather than order-dependent. The
 * main process emits a session change and a history load as two separate events,
 * and the renderer clears its messages whenever the active session changes — so
 * an untagged transcript that arrives on either side of that change is
 * indistinguishable from the right one, and applying the wrong one silently shows
 * an empty chat.
 */
export interface ChatHistoryPayload {
  /** The session the messages belong to, or null when there is no active session. */
  sessionId: string | null
  /** The session's messages, in order. */
  messages: PersistedMessage[]
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
  /**
   * Whether the title is a name someone set, rather than one derived from the
   * first message.
   *
   * This is what keeps auto-titling from running twice or overwriting a manual
   * rename: a session is a candidate for a generated title only while this is
   * false, and writing one sets it.
   */
  hasExplicitName: boolean
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
