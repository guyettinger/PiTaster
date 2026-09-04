/**
 * MCP Client for connecting to stdio-based MCP servers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpSourceConfig, McpTool } from '@pitaster/core'
import { buildSubprocessEnv } from '../process/env.js'

/**
 * Client for connecting to MCP (Model Context Protocol) servers via stdio.
 */
export class McpClient {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null

  /**
   * Creates an MCP client instance.
   * @param config - The MCP source configuration
   */
  constructor(private config: McpSourceConfig) {}

  /**
   * Connect to the MCP server.
   * @returns The available tools from the server
   */
  async connect(): Promise<McpTool[]> {
    // Strip the user's credentials before the server process sees them.
    const env = buildSubprocessEnv(this.config.env)

    // Create client
    this.client = new Client({
      name: `pitaster-${this.config.id}`,
      version: '1.0.0'
    })

    // Create transport
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env
    })

    // Connect
    await this.client.connect(this.transport)

    // List available tools
    const tools = await this.listTools()
    return tools
  }

  /**
   * List available tools from the server.
   * @returns Array of tool definitions
   * @throws Error if not connected
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.client) {
      throw new Error('Not connected')
    }

    const result = await this.client.listTools()
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
  }

  /**
   * Call a tool on the server.
   * @param name - The tool name to call
   * @param args - Arguments to pass to the tool
   * @returns The tool result
   * @throws Error if not connected
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('Not connected')
    }

    const result = await this.client.callTool({ name, arguments: args })
    return result
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.transport = null
    }
  }

  /**
   * Check if connected.
   * @returns True if connected to an MCP server
   */
  isConnected(): boolean {
    return this.client !== null
  }
}
