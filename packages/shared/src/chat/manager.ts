/**
 * Manages persistent chat history for sub-apps.
 *
 * Chat messages are stored as individual JSON files in each app's
 * .chat-history/ directory, named with timestamps for chronological ordering.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { PersistedMessage } from '@anyapp/core'

/**
 * Manages chat history storage for sub-apps.
 */
export class ChatHistoryManager {
  private appsDir: string

  constructor() {
    this.appsDir = join(homedir(), '.anyapp', 'apps')
  }

  /**
   * Get the chat history directory for an app.
   * @param appId - The app identifier
   * @returns Path to the .chat-history/ directory
   */
  getHistoryDir(appId: string): string {
    return join(this.appsDir, appId, '.chat-history')
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
   * Load all chat history for an app, sorted chronologically.
   * @param appId - The app identifier
   * @returns Array of persisted messages sorted by timestamp
   */
  async loadHistory(appId: string): Promise<PersistedMessage[]> {
    const historyDir = this.getHistoryDir(appId)

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
   * Save a message to the history directory.
   * @param appId - The app identifier
   * @param message - The message to save
   */
  async saveMessage(appId: string, message: PersistedMessage): Promise<void> {
    const historyDir = this.getHistoryDir(appId)
    await fs.mkdir(historyDir, { recursive: true })

    const filename = this.generateFilename(message)
    const filepath = join(historyDir, filename)
    await fs.writeFile(filepath, JSON.stringify(message, null, 2))
  }

  /**
   * Delete a specific message from history.
   * @param appId - The app identifier
   * @param messageId - The message ID to delete
   */
  async deleteMessage(appId: string, messageId: string): Promise<void> {
    const historyDir = this.getHistoryDir(appId)

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
   * Clear all chat history for an app.
   * @param appId - The app identifier
   */
  async clearHistory(appId: string): Promise<void> {
    const historyDir = this.getHistoryDir(appId)

    try {
      const files = await fs.readdir(historyDir)
      await Promise.all(files.map((f) => fs.unlink(join(historyDir, f))))
    } catch {
      // Directory doesn't exist
    }
  }
}
