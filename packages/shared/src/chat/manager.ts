/**
 * Chat session storage, backed by Pi's session transcripts.
 *
 * Pi owns the conversation: it writes a tree-structured JSONL transcript per session,
 * with `id`/`parentId` links that support branching and forking. This module adapts
 * that store to the {@link ChatSession} and {@link PersistedMessage} shapes the
 * renderer already speaks, so the UI does not need to know about Pi's format.
 *
 * The only thing anyapp still persists itself is which session is active, which Pi
 * has no concept of.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { CURRENT_SESSION_VERSION, SessionManager } from '@earendil-works/pi-coding-agent'
import type {
  ChatSession,
  ChatSessionManifest,
  CreateChatSessionParams,
  PersistedMessage,
  SerializedContentBlock
} from '@anyapp/core'
import { getAppPath, getAppSessionDir, getPiAgentDir } from './session-paths.js'

/** Filename holding the active-session pointer, inside the sub-app directory. */
const ACTIVE_SESSION_FILE = '.chat-sessions.json'

/** Title used for a session that has no name and no messages yet. */
const UNTITLED_SESSION = 'New Chat'

/** Maximum characters of the first user message used as a fallback title. */
const TITLE_MAX_CHARS = 60

/**
 * The per-app state anyapp persists alongside Pi's transcripts.
 */
interface ActiveSessionPointer {
  /** Pi session id currently selected in the UI, or null. */
  activeSessionId: string | null
}

/**
 * A Pi transcript entry, narrowed to the parts this module reads.
 */
interface PiMessageEntry {
  /** Entry kind. */
  type: string
  /** Entry identifier. */
  id: string
  /** ISO timestamp or epoch milliseconds. */
  timestamp?: string | number
  /** The message payload, present when `type` is `message`. */
  message?: PiMessage
}

/**
 * A Pi message payload.
 */
interface PiMessage {
  /** Who produced the message. */
  role: 'user' | 'assistant' | 'toolResult'
  /** Content blocks, or a plain string for simple user messages. */
  content: string | PiContentBlock[]
  /** Identifier of the tool call, on `toolResult` messages. */
  toolCallId?: string
  /** Name of the tool, on `toolResult` messages. */
  toolName?: string
  /** Whether the tool reported failure. */
  isError?: boolean
}

/**
 * A Pi content block.
 */
interface PiContentBlock {
  /** Block kind. */
  type: string
  /** Text payload, for `text` and `thinking` blocks. */
  text?: string
  /** Tool call identifier, for `toolCall` blocks. */
  id?: string
  /** Tool name, for `toolCall` blocks. */
  name?: string
  /** Tool arguments, for `toolCall` blocks. */
  arguments?: Record<string, unknown>
}

/**
 * Manages chat sessions and their transcripts for anyapp's sub-apps.
 */
export class ChatHistoryManager {
  /** Pi agent directory holding all session transcripts. */
  private readonly agentDir: string

  /**
   * Creates a new ChatHistoryManager.
   * @param agentDir - Pi agent directory; defaults to `~/.anyapp/pi`
   */
  constructor(agentDir: string = getPiAgentDir()) {
    this.agentDir = agentDir
  }

  /**
   * Resolve the Pi session directory for one app.
   * @param appId - The sub-app identifier
   * @returns Absolute path to that app's session directory
   */
  private sessionDir(appId: string): string {
    return getAppSessionDir({ agentDir: this.agentDir, appPath: getAppPath(appId) })
  }

  /**
   * Read the active-session pointer for one app.
   * @param appId - The sub-app identifier
   * @returns The stored pointer, or a null pointer when none exists
   */
  private async readPointer(appId: string): Promise<ActiveSessionPointer> {
    try {
      const raw = await fs.readFile(join(getAppPath(appId), ACTIVE_SESSION_FILE), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ActiveSessionPointer>
      return {
        activeSessionId:
          typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null
      }
    } catch {
      return { activeSessionId: null }
    }
  }

  /**
   * Write the active-session pointer for one app.
   * @param appId - The sub-app identifier
   * @param pointer - The pointer to persist
   */
  private async writePointer(appId: string, pointer: ActiveSessionPointer): Promise<void> {
    const appPath = getAppPath(appId)
    await fs.mkdir(appPath, { recursive: true })
    await fs.writeFile(
      join(appPath, ACTIVE_SESSION_FILE),
      JSON.stringify(pointer, null, 2),
      'utf-8'
    )
  }

  /**
   * Find the transcript file for a session id.
   * @param appId - The sub-app identifier
   * @param sessionId - The Pi session id
   * @returns The transcript path, or null when the session no longer exists
   */
  async getSessionPath(appId: string, sessionId: string): Promise<string | null> {
    const infos = await SessionManager.list(getAppPath(appId), this.sessionDir(appId))
    return infos.find((info) => info.id === sessionId)?.path ?? null
  }

  /**
   * List all sessions for an app, most recently modified first.
   * @param appId - The sub-app identifier
   * @returns The app's chat sessions
   */
  async listSessions(appId: string): Promise<ChatSession[]> {
    const infos = await SessionManager.list(getAppPath(appId), this.sessionDir(appId))

    return infos
      .map((info) => ({
        id: info.id,
        title: info.name?.trim() || deriveTitle(info.firstMessage),
        createdAt: info.created.toISOString(),
        updatedAt: info.modified.toISOString(),
        messageCount: info.messageCount
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Load the session list plus the active-session pointer.
   * @param appId - The sub-app identifier
   * @returns The app's session manifest
   */
  async loadManifest(appId: string): Promise<ChatSessionManifest> {
    const sessions = await this.listSessions(appId)
    const { activeSessionId } = await this.readPointer(appId)

    // Drop a pointer to a session that has since been deleted.
    const resolved = sessions.some((session) => session.id === activeSessionId)
      ? activeSessionId
      : (sessions[0]?.id ?? null)

    return { activeSessionId: resolved, sessions }
  }

  /**
   * Persist the active-session pointer from a manifest.
   * @param appId - The sub-app identifier
   * @param manifest - The manifest whose pointer should be stored
   */
  async saveManifest(appId: string, manifest: ChatSessionManifest): Promise<void> {
    await this.writePointer(appId, { activeSessionId: manifest.activeSessionId })
  }

  /**
   * Create a new, empty session and make it active.
   * @param appId - The sub-app identifier
   * @param params - Optional title for the new session
   * @returns The created session
   */
  async createSession(
    appId: string,
    params?: CreateChatSessionParams
  ): Promise<ChatSession> {
    const appPath = getAppPath(appId)
    const sessionDir = this.sessionDir(appId)
    await fs.mkdir(appPath, { recursive: true })
    await fs.mkdir(sessionDir, { recursive: true })

    // Pi defers writing a transcript until the first assistant reply, so a session
    // created here would not exist on disk and would vanish from the UI. Writing the
    // header ourselves makes it real immediately, with an id that never changes:
    // SessionManager.open() then appends to it normally.
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const file = join(sessionDir, `${createdAt.replace(/[:.]/g, '-')}_${id}.jsonl`)
    const header = {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp: createdAt,
      cwd: appPath
    }
    await fs.writeFile(file, `${JSON.stringify(header)}\n`, 'utf-8')

    const title = params?.title?.trim() || UNTITLED_SESSION
    SessionManager.open(file, sessionDir).appendSessionInfo(title)

    await this.writePointer(appId, { activeSessionId: id })

    return { id, title, createdAt, updatedAt: createdAt, messageCount: 0 }
  }

  /**
   * Delete a session and its transcript.
   * @param appId - The sub-app identifier
   * @param sessionId - The session to delete
   */
  async deleteSession(appId: string, sessionId: string): Promise<void> {
    const path = await this.getSessionPath(appId, sessionId)
    if (path) {
      await fs.rm(path, { force: true })
    }

    const { activeSessionId } = await this.readPointer(appId)
    if (activeSessionId === sessionId) {
      const remaining = await this.listSessions(appId)
      await this.writePointer(appId, { activeSessionId: remaining[0]?.id ?? null })
    }
  }

  /**
   * Rename a session.
   * @param appId - The sub-app identifier
   * @param sessionId - The session to rename
   * @param title - The new title
   * @returns The updated session
   * @throws {Error} If the session does not exist
   */
  async renameSession(
    appId: string,
    sessionId: string,
    title: string
  ): Promise<ChatSession> {
    const path = await this.getSessionPath(appId, sessionId)
    if (!path) throw new Error(`Session not found: ${sessionId}`)

    SessionManager.open(path, this.sessionDir(appId)).appendSessionInfo(title)

    const sessions = await this.listSessions(appId)
    const updated = sessions.find((session) => session.id === sessionId)
    if (!updated) throw new Error(`Session not found: ${sessionId}`)
    return updated
  }

  /**
   * Get the active session id for an app.
   * @param appId - The sub-app identifier
   * @returns The active session id, or null when there is none
   */
  async getActiveSessionId(appId: string): Promise<string | null> {
    return (await this.loadManifest(appId)).activeSessionId
  }

  /**
   * Set the active session for an app.
   * @param appId - The sub-app identifier
   * @param sessionId - The session to activate
   */
  async setActiveSession(appId: string, sessionId: string): Promise<void> {
    await this.writePointer(appId, { activeSessionId: sessionId })
  }

  /**
   * Load a session's transcript as renderer-facing messages.
   *
   * Pi's transcript is the source of truth, so this reflects tool calls and their
   * results rather than the text-only view the previous store kept.
   *
   * @param appId - The sub-app identifier
   * @param sessionId - The session to load
   * @returns The session's messages in order, or an empty array when it is missing
   */
  async loadHistory(appId: string, sessionId: string): Promise<PersistedMessage[]> {
    const path = await this.getSessionPath(appId, sessionId)
    if (!path) return []

    const manager = SessionManager.open(path, this.sessionDir(appId))
    // getBranch() walks root -> current leaf, which is the conversation as displayed.
    const entries = manager.getBranch() as unknown as PiMessageEntry[]

    return toPersistedMessages(entries)
  }

  /**
   * Clear a session by deleting its transcript and starting a fresh one.
   * @param appId - The sub-app identifier
   * @param sessionId - The session to clear
   */
  async clearHistory(appId: string, sessionId: string): Promise<void> {
    await this.deleteSession(appId, sessionId)
    await this.createSession(appId)
  }

  /**
   * Resolve the transcript file backing the active session.
   * @param appId - The sub-app identifier
   * @returns The transcript path, or null when there is no active session
   */
  async getActiveSessionPath(appId: string): Promise<string | null> {
    const { activeSessionId } = await this.readPointer(appId)
    if (!activeSessionId) return null
    return this.getSessionPath(appId, activeSessionId)
  }
}

/**
 * Derive a display title from a session's first user message.
 * @param firstMessage - The first message text, possibly empty
 * @returns A short title
 */
function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().split('\n')[0] ?? ''
  if (trimmed.length === 0) return UNTITLED_SESSION
  return trimmed.length > TITLE_MAX_CHARS
    ? `${trimmed.slice(0, TITLE_MAX_CHARS)}...`
    : trimmed
}

/**
 * Normalize a Pi entry timestamp to an ISO string.
 * @param timestamp - Epoch milliseconds, an ISO string, or undefined
 * @returns An ISO timestamp
 */
function toIsoTimestamp(timestamp: string | number | undefined): string {
  if (typeof timestamp === 'number') return new Date(timestamp).toISOString()
  if (typeof timestamp === 'string') return timestamp
  return new Date().toISOString()
}

/**
 * Extract plain text from a Pi message's content.
 * @param content - The message content
 * @returns The concatenated text, excluding thinking blocks
 */
function extractText(content: string | PiContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
}

/**
 * Convert a Pi transcript into renderer-facing messages.
 *
 * Tool calls and their results arrive as separate Pi messages; they are stitched
 * back together here so a call and its output render as one block.
 *
 * @param entries - The transcript entries, in order
 * @returns The messages to display
 */
function toPersistedMessages(entries: PiMessageEntry[]): PersistedMessage[] {
  const messages: PersistedMessage[] = []
  /** Tool blocks awaiting their result, keyed by tool call id. */
  const pendingTools = new Map<string, SerializedContentBlock & { type: 'tool' }>()

  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue
    const { role, content } = entry.message
    const timestamp = toIsoTimestamp(entry.timestamp)

    if (role === 'toolResult') {
      const block = entry.message.toolCallId
        ? pendingTools.get(entry.message.toolCallId)
        : undefined
      if (block) {
        block.status = entry.message.isError ? 'error' : 'complete'
        const text = extractText(content)
        if (entry.message.isError) {
          block.error = text
        } else {
          block.output = text
        }
        pendingTools.delete(entry.message.toolCallId as string)
      }
      continue
    }

    const blocks: SerializedContentBlock[] = []

    if (typeof content === 'string') {
      if (content.length > 0) blocks.push({ type: 'text', content })
    } else {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          blocks.push({ type: 'text', content: block.text })
        } else if (block.type === 'toolCall' && block.name) {
          const toolBlock = {
            type: 'tool' as const,
            name: block.name,
            toolCallId: block.id,
            input: block.arguments,
            status: 'running' as const
          }
          blocks.push(toolBlock)
          if (block.id) pendingTools.set(block.id, toolBlock)
        }
        // `thinking` blocks are internal reasoning and are not surfaced.
      }
    }

    if (blocks.length === 0) continue

    messages.push({
      id: entry.id,
      role: role === 'assistant' ? 'assistant' : 'user',
      blocks,
      timestamp
    })
  }

  return messages
}
