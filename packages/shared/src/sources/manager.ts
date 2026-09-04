/**
 * Source Manager for managing external source connections.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AnySourceConfig, ConnectedSource, McpSourceConfig } from '@pitaster/core'
import { McpClient } from './mcp-client.js'

/**
 * Manages source configurations and connections.
 */
export class SourceManager {
  private sources = new Map<string, ConnectedSource>()
  private mcpClients = new Map<string, McpClient>()

  /**
   * Creates a SourceManager instance.
   * @param configDir - The configuration directory (e.g., ~/.pitaster)
   */
  constructor(private configDir: string) {}

  /**
   * Load all source configurations from disk.
   * @returns Array of source configurations
   */
  async loadSources(): Promise<AnySourceConfig[]> {
    const sourcesDir = join(this.configDir, 'sources')

    try {
      const files = await fs.readdir(sourcesDir)
      const configs: AnySourceConfig[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(join(sourcesDir, file), 'utf-8')
          configs.push(JSON.parse(content))
        }
      }

      return configs
    } catch {
      return []
    }
  }

  /**
   * Save a source configuration to disk.
   * @param config - The source configuration to save
   */
  async saveSource(config: AnySourceConfig): Promise<void> {
    const sourcesDir = join(this.configDir, 'sources')
    await fs.mkdir(sourcesDir, { recursive: true })

    const filepath = join(sourcesDir, `${config.id}.json`)
    await fs.writeFile(filepath, JSON.stringify(config, null, 2))
  }

  /**
   * Delete a source configuration from disk.
   * @param id - The source ID to delete
   */
  async deleteSource(id: string): Promise<void> {
    // Disconnect first if connected
    await this.disconnect(id)

    const sourcesDir = join(this.configDir, 'sources')
    const filepath = join(sourcesDir, `${id}.json`)

    try {
      await fs.unlink(filepath)
    } catch {
      // File may not exist, ignore
    }

    this.sources.delete(id)
  }

  /**
   * Connect to a source.
   * @param config - The source configuration
   * @returns The connected source state
   */
  async connect(config: AnySourceConfig): Promise<ConnectedSource> {
    if (config.type === 'mcp') {
      const client = new McpClient(config as McpSourceConfig)

      try {
        const tools = await client.connect()
        this.mcpClients.set(config.id, client)

        const connected: ConnectedSource = {
          config,
          connected: true,
          tools
        }
        this.sources.set(config.id, connected)
        return connected
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        const failed: ConnectedSource = {
          config,
          connected: false,
          error: message
        }
        this.sources.set(config.id, failed)
        return failed
      }
    }

    // API and filesystem sources not yet implemented
    throw new Error(`Source type ${config.type} not yet implemented`)
  }

  /**
   * Disconnect from a source.
   * @param sourceId - The source ID to disconnect
   */
  async disconnect(sourceId: string): Promise<void> {
    const client = this.mcpClients.get(sourceId)
    if (client) {
      await client.disconnect()
      this.mcpClients.delete(sourceId)
    }

    const source = this.sources.get(sourceId)
    if (source) {
      source.connected = false
      source.tools = undefined
      this.sources.set(sourceId, source)
    }
  }

  /**
   * Call a tool on a connected source.
   * @param sourceId - The source ID
   * @param toolName - The tool name to call
   * @param args - Arguments to pass to the tool
   * @returns The tool result
   * @throws Error if source not connected
   */
  async callTool(
    sourceId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = this.mcpClients.get(sourceId)
    if (!client) {
      throw new Error(`Source ${sourceId} not connected`)
    }

    return client.callTool(toolName, args)
  }

  /**
   * Get all sources with their connection state.
   * @returns Array of connected source states
   */
  getConnectedSources(): ConnectedSource[] {
    return Array.from(this.sources.values())
  }

  /**
   * Get a specific source by ID.
   * @param id - The source ID
   * @returns The connected source or undefined
   */
  getSource(id: string): ConnectedSource | undefined {
    return this.sources.get(id)
  }

  /**
   * Disconnect all sources.
   */
  async disconnectAll(): Promise<void> {
    for (const sourceId of this.mcpClients.keys()) {
      await this.disconnect(sourceId)
    }
  }
}
