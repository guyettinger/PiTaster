/**
 * Manages persistent chat history for sub-apps.
 *
 * Chat messages are stored as individual JSON files in each app's
 * .chat-history/{session-id}/ directory, with a session manifest
 * (.chat-sessions.json) tracking all sessions per app.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type {
  PersistedMessage,
  ChatSession,
  ChatSessionManifest,
  CreateChatSessionParams
} from '@anyapp/core'

/**
 * Manages chat history storage for sub-apps with session support.
 */
export class ChatHistoryManager {
  private appsDir: string

  constructor() {
    this.appsDir = join(homedir(), '.anyapp', 'apps')
  }

  // --- Session Manifest ---

  /**
   * Get the path to the sessions manifest file.
   * @param appId - The app identifier
   * @returns Path to the .chat-sessions.json file
   */
  private getManifestPath(appId: string): string {
    return join(this.appsDir, appId, '.chat-sessions.json')
  }

  /**
   * Load the session manifest for an app.
   * If no manifest exists, checks for legacy flat history and migrates.
   * @param appId - The app identifier
   * @returns The session manifest
   */
  async loadManifest(appId: string): Promise<ChatSessionManifest> {
    const manifestPath = this.getManifestPath(appId)

    try {
      const data = await fs.readFile(manifestPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      // No manifest — check for legacy flat history to migrate
      return this.migrateOrCreateManifest(appId)
    }
  }

  /**
   * Save the session manifest.
   * @param appId - The app identifier
   * @param manifest - The manifest to save
   */
  async saveManifest(appId: string, manifest: ChatSessionManifest): Promise<void> {
    const manifestPath = this.getManifestPath(appId)
    await fs.mkdir(join(this.appsDir, appId), { recursive: true })
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  }

  /**
   * Migrate legacy flat .chat-history/ to session-based structure,
   * or create a fresh manifest if no history exists.
   * @param appId - The app identifier
   * @returns The newly created manifest
   */
  private async migrateOrCreateManifest(appId: string): Promise<ChatSessionManifest> {
    const legacyDir = join(this.appsDir, appId, '.chat-history')

    try {
      const entries = await fs.readdir(legacyDir, { withFileTypes: true })
      const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json'))

      if (jsonFiles.length > 0) {
        // Legacy messages exist — migrate into a "default" session
        const sessionDir = join(legacyDir, 'default')
        await fs.mkdir(sessionDir, { recursive: true })

        for (const entry of jsonFiles) {
          await fs.rename(join(legacyDir, entry.name), join(sessionDir, entry.name))
        }

        const manifest: ChatSessionManifest = {
          activeSessionId: 'default',
          sessions: [
            {
              id: 'default',
              title: 'Chat',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messageCount: jsonFiles.length
            }
          ]
        }

        await this.saveManifest(appId, manifest)
        return manifest
      }
    } catch {
      // No legacy directory — fresh app
    }

    // No history at all — empty manifest
    const manifest: ChatSessionManifest = {
      activeSessionId: null,
      sessions: []
    }
    await this.saveManifest(appId, manifest)
    return manifest
  }

  // --- Session CRUD ---

  /**
   * Create a new chat session.
   * @param appId - The app identifier
   * @param params - Optional creation parameters
   * @returns The newly created session
   */
  async createSession(appId: string, params?: CreateChatSessionParams): Promise<ChatSession> {
    const manifest = await this.loadManifest(appId)

    const session: ChatSession = {
      id: `sess_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      title: params?.title || 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0
    }

    // Create the session directory
    const sessionDir = this.getHistoryDir(appId, session.id)
    await fs.mkdir(sessionDir, { recursive: true })

    // Add to manifest and set as active
    manifest.sessions.push(session)
    manifest.activeSessionId = session.id
    await this.saveManifest(appId, manifest)

    return session
  }

  /**
   * Delete a chat session and all its messages.
   * @param appId - The app identifier
   * @param sessionId - The session to delete
   */
  async deleteSession(appId: string, sessionId: string): Promise<void> {
    const manifest = await this.loadManifest(appId)

    // Remove session from manifest
    manifest.sessions = manifest.sessions.filter((s) => s.id !== sessionId)

    // If we deleted the active session, activate the most recent remaining
    if (manifest.activeSessionId === sessionId) {
      const sorted = [...manifest.sessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      manifest.activeSessionId = sorted[0]?.id ?? null
    }

    await this.saveManifest(appId, manifest)

    // Delete the session directory
    const sessionDir = this.getHistoryDir(appId, sessionId)
    try {
      await fs.rm(sessionDir, { recursive: true, force: true })
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Rename a chat session.
   * @param appId - The app identifier
   * @param sessionId - The session to rename
   * @param title - The new title
   * @returns The updated session
   */
  async renameSession(appId: string, sessionId: string, title: string): Promise<ChatSession> {
    const manifest = await this.loadManifest(appId)
    const session = manifest.sessions.find((s) => s.id === sessionId)

    if (!session) {
      throw new Error(`Session "${sessionId}" not found`)
    }

    session.title = title
    session.updatedAt = new Date().toISOString()
    await this.saveManifest(appId, manifest)

    return session
  }

  /**
   * List all sessions for an app.
   * @param appId - The app identifier
   * @returns Array of chat sessions
   */
  async listSessions(appId: string): Promise<ChatSession[]> {
    const manifest = await this.loadManifest(appId)
    return manifest.sessions
  }

  /**
   * Get the active session ID for an app.
   * @param appId - The app identifier
   * @returns The active session ID, or null if none
   */
  async getActiveSessionId(appId: string): Promise<string | null> {
    const manifest = await this.loadManifest(appId)
    return manifest.activeSessionId
  }

  /**
   * Set the active session for an app.
   * @param appId - The app identifier
   * @param sessionId - The session to activate
   */
  async setActiveSession(appId: string, sessionId: string): Promise<void> {
    const manifest = await this.loadManifest(appId)

    if (!manifest.sessions.find((s) => s.id === sessionId)) {
      throw new Error(`Session "${sessionId}" not found`)
    }

    manifest.activeSessionId = sessionId
    await this.saveManifest(appId, manifest)
  }

  // --- Message Operations (session-aware) ---

  /**
   * Get the chat history directory for a session.
   * @param appId - The app identifier
   * @param sessionId - The session identifier
   * @returns Path to the session's history directory
   */
  getHistoryDir(appId: string, sessionId: string): string {
    return join(this.appsDir, appId, '.chat-history', sessionId)
  }

  /**
   * Generate a filename for a message.
   * Format: {timestamp}_{id}.json with colons replaced by hyphens.
   * @param message - The message to generate a filename for
   * @returns The generated filename
   */
  generateFilename(message: PersistedMessage): string {
    // Replace : with - for filesystem compatibility
    const safeTimestamp = message.timestamp.replace(/:/g, '-')
    return `${safeTimestamp}_${message.id}.json`
  }

  /**
   * Load all messages for a specific session, sorted chronologically.
   * @param appId - The app identifier
   * @param sessionId - The session identifier
   * @returns Array of persisted messages sorted by timestamp
   */
  async loadHistory(appId: string, sessionId: string): Promise<PersistedMessage[]> {
    const historyDir = this.getHistoryDir(appId, sessionId)

    try {
      const files = await fs.readdir(historyDir)
      const jsonFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort() // Alphabetical = chronological due to filename format

      const messages: PersistedMessage[] = []
      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(join(historyDir, file), 'utf-8')
          messages.push(JSON.parse(content))
        } catch {
          // Skip malformed files
        }
      }

      return messages
    } catch {
      // Directory doesn't exist yet
      return []
    }
  }

  /**
   * Save a message to a session's history directory.
   * Also updates the session's updatedAt and messageCount in the manifest.
   * @param appId - The app identifier
   * @param sessionId - The session identifier
   * @param message - The message to save
   */
  async saveMessage(appId: string, sessionId: string, message: PersistedMessage): Promise<void> {
    const historyDir = this.getHistoryDir(appId, sessionId)
    await fs.mkdir(historyDir, { recursive: true })

    const filename = this.generateFilename(message)
    const filepath = join(historyDir, filename)
    await fs.writeFile(filepath, JSON.stringify(message, null, 2))

    // Update manifest metadata
    try {
      const manifest = await this.loadManifest(appId)
      const session = manifest.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.updatedAt = new Date().toISOString()
        session.messageCount += 1
        await this.saveManifest(appId, manifest)
      }
    } catch {
      // Non-critical — manifest update failure shouldn't block message save
    }
  }

  /**
   * Delete a specific message from a session's history.
   * @param appId - The app identifier
   * @param sessionId - The session identifier
   * @param messageId - The message ID to delete
   */
  async deleteMessage(appId: string, sessionId: string, messageId: string): Promise<void> {
    const historyDir = this.getHistoryDir(appId, sessionId)

    try {
      const files = await fs.readdir(historyDir)
      const targetFile = files.find((f) => f.includes(`_${messageId}.json`))
      if (targetFile) {
        await fs.unlink(join(historyDir, targetFile))
      }
    } catch {
      // Directory or file doesn't exist
    }
  }

  /**
   * Clear all messages in a session.
   * @param appId - The app identifier
   * @param sessionId - The session identifier
   */
  async clearHistory(appId: string, sessionId: string): Promise<void> {
    const historyDir = this.getHistoryDir(appId, sessionId)

    try {
      const files = await fs.readdir(historyDir)
      await Promise.all(files.map((f) => fs.unlink(join(historyDir, f))))
    } catch {
      // Directory doesn't exist
    }

    // Reset message count in manifest
    try {
      const manifest = await this.loadManifest(appId)
      const session = manifest.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.messageCount = 0
        session.updatedAt = new Date().toISOString()
        await this.saveManifest(appId, manifest)
      }
    } catch {
      // Non-critical
    }
  }
}
