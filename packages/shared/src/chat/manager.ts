/**
 * Chat session storage, backed by Pi's session transcripts.
 *
 * Pi owns the conversation: it writes a tree-structured JSONL transcript per session,
 * with `id`/`parentId` links that support branching and forking. This module adapts
 * that store to the {@link ChatSession} and {@link PersistedMessage} shapes the
 * renderer already speaks, so the UI does not need to know about Pi's format.
 *
 * The only thing Key Lime Pi still persists itself is which session is active, which Pi
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
  FilePatch,
  PersistedMessage,
  SerializedContentBlock
} from '@keylimepi/core'
import { getAppPath, getAppSessionDir, getPiAgentDir } from './session-paths.js'

/** Filename holding the active-session pointer, inside the sub-app directory. */
const ACTIVE_SESSION_FILE = '.chat-sessions.json'

/** Title used for a session that has no name and no messages yet. */
const UNTITLED_SESSION = 'New Chat'

/** Maximum characters of the first user message used as a fallback title. */
const TITLE_MAX_CHARS = 60

/**
 * The longest title accepted for a chat session.
 *
 * The cap belongs here rather than only on the handler that happens to receive a
 * title, for the same reason `MAX_ID_LENGTH` lives in `session-baselines.ts`: this
 * is where every route converges. A title arrives from `sessions:rename`, from
 * `sessions:create`'s params, and from the model through `summarizeSessionTitle` —
 * and only the last of those bounds its own output (`TITLE_MAX_CHARS` there is 60).
 * A bound checked at one channel is a bound the other channels do not have, and the
 * value is appended verbatim into Pi's transcript on disk, so an unbounded one is
 * not a bad argument to one call but a permanent entry in a file the sidebar reads
 * end to end on every turn.
 *
 * Two hundred is far past any title anyone types and three times what the generated
 * ones are allowed.
 */
export const MAX_SESSION_TITLE_CHARS = 200

/**
 * Reject a session title the caller should never have supplied.
 *
 * @param title - The value to check
 * @throws {Error} If it is not a non-empty string of usable length
 */
export function assertSessionTitle(title: unknown): asserts title is string {
  if (
    typeof title !== 'string' ||
    title.trim().length === 0 ||
    title.length > MAX_SESSION_TITLE_CHARS
  ) {
    throw new Error('Invalid session title')
  }
}

/**
 * What Pi's `buildSessionInfo` puts in `firstMessage` when a session has none.
 *
 * It is a display string, not an absence, so it has to be recognised — otherwise
 * a session that has never been used is titled "(no messages)".
 */
const PI_NO_MESSAGES = '(no messages)'

/**
 * Names that were written by the bug rather than chosen by anyone.
 *
 * Every session created before this was fixed had one of these stamped into its
 * transcript, which is what made the whole sidebar read "New Chat". They are
 * treated as no name at all, so those sessions get a derived title and become
 * eligible for a generated one — otherwise the fix would only ever reach chats
 * created after it, and an existing install would look unchanged.
 *
 * The cost is that someone who deliberately renamed a chat to exactly "New Chat"
 * loses that name. Against a sidebar of identical rows, that is the right trade.
 */
const LEGACY_PLACEHOLDER_NAMES: readonly string[] = ['New Chat', 'Chat']

/**
 * Whether a stored session name is one the old `createSession` stamped on.
 * @param name - The trimmed name read from the transcript
 * @returns True when the name should be treated as no name at all
 */
export function isLegacyPlaceholderName(name: string): boolean {
  return LEGACY_PLACEHOLDER_NAMES.includes(name)
}

/**
 * The per-app state Key Lime Pi persists alongside Pi's transcripts.
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
 * Manages chat sessions and their transcripts for Key Lime Pi's sub-apps.
 */
export class ChatHistoryManager {
  /** Pi agent directory holding all session transcripts. */
  private readonly agentDir: string

  /**
   * Creates a new ChatHistoryManager.
   * @param agentDir - Pi agent directory; defaults to `~/.keylimepi/pi`
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
      .map((info) => {
        const stored = info.name?.trim()
        const name = stored && !isLegacyPlaceholderName(stored) ? stored : undefined
        return {
          id: info.id,
          title: name || deriveTitle(info.firstMessage),
          createdAt: info.created.toISOString(),
          updatedAt: info.modified.toISOString(),
          messageCount: info.messageCount,
          hasExplicitName: Boolean(name)
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Read a session's first user message.
   *
   * This is the text a title is derived or generated from. Pi reports it as part of
   * its session listing, so nothing needs to parse the transcript for it.
   *
   * @param appId - The sub-app identifier
   * @param sessionId - The session to read
   * @returns The first user message, or null when the session has none
   */
  async getFirstUserMessage(appId: string, sessionId: string): Promise<string | null> {
    const infos = await SessionManager.list(getAppPath(appId), this.sessionDir(appId))
    const first = infos.find((info) => info.id === sessionId)?.firstMessage?.trim()
    if (!first || first === PI_NO_MESSAGES) return null
    return first
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

    // Only write a name when the caller actually supplied one. Stamping every new
    // session with "New Chat" sets Pi's `SessionInfo.name`, which makes the
    // `deriveTitle` fallback in listSessions() unreachable — so every chat in the
    // sidebar kept that placeholder for the rest of its life.
    // Checked before the trim rather than after, so a non-string is refused rather
    // than throwing a TypeError out of `.trim()` on an untrusted argument.
    if (params?.title !== undefined) assertSessionTitle(params.title)
    const explicitTitle = params?.title?.trim()
    if (explicitTitle) {
      SessionManager.open(file, sessionDir).appendSessionInfo(explicitTitle)
    }

    await this.writePointer(appId, { activeSessionId: id })

    return {
      id,
      title: explicitTitle || UNTITLED_SESSION,
      createdAt,
      updatedAt: createdAt,
      messageCount: 0,
      hasExplicitName: Boolean(explicitTitle)
    }
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
    assertSessionTitle(title)

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
 *
 * Exported for its tests: it is the only title a chat has until the model names
 * one, and it reads a value Pi fills in with a display string rather than leaving
 * empty, which is exactly the kind of thing that regresses silently.
 *
 * @param firstMessage - The first message text, possibly empty
 * @returns A short title
 */
export function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().split('\n')[0] ?? ''
  if (trimmed.length === 0 || trimmed === PI_NO_MESSAGES) return UNTITLED_SESSION
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
 * Lift the diffs a write produced out of a persisted tool result's `details`.
 *
 * `details` is whatever the tool chose to put there, and a transcript on disk may have
 * been written by an older version of Key Lime Pi — so every field is checked rather than
 * asserted. A malformed entry costs a diff, never a failed history load.
 *
 * @param details - The tool result's `details`, in whatever shape it was persisted
 * @returns The patches, or an empty array
 */
function readPatches(details: unknown): FilePatch[] {
  const candidates = (details as { patches?: unknown } | null | undefined)?.patches
  if (!Array.isArray(candidates)) return []

  return candidates.filter((entry): entry is FilePatch => {
    const patch = entry as Partial<FilePatch> | null
    return (
      !!patch &&
      typeof patch.path === 'string' &&
      typeof patch.patch === 'string' &&
      typeof patch.added === 'number' &&
      typeof patch.removed === 'number'
    )
  })
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
          // The diff the tool put on its `details`, which Pi persists alongside the
          // result. Reading it back is what lets a reloaded transcript still show what
          // the agent changed, rather than only the session that watched it happen.
          // Read off the message rather than a narrowed binding: `role` was destructured
          // above, which does not narrow `entry.message` itself. `readPatches` takes
          // `unknown` and validates, so nothing is asserted here that is not checked there.
          const patches = readPatches((entry.message as { details?: unknown }).details)
          if (patches.length > 0) block.patches = patches
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
