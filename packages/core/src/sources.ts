/**
 * Source configuration and connection types for anyapp.
 */

/**
 * Base source configuration.
 */
export interface SourceConfig {
  /** Unique source ID. */
  id: string
  /** Display name. */
  name: string
  /** Source type. */
  type: 'mcp' | 'api' | 'filesystem'
  /** Whether source is enabled. */
  enabled: boolean
  /** ISO timestamp when created. */
  createdAt: string
}

/**
 * MCP server source configuration.
 */
export interface McpSourceConfig extends SourceConfig {
  type: 'mcp'
  /** Command to run (e.g., 'npx'). */
  command: string
  /** Command arguments. */
  args: string[]
  /** Environment variables to pass. */
  env?: Record<string, string>
}

/**
 * REST API source configuration.
 */
export interface ApiSourceConfig extends SourceConfig {
  type: 'api'
  /** Base URL. */
  baseUrl: string
  /** Authentication type. */
  authType: 'none' | 'apiKey' | 'oauth'
  /** API key (if authType is 'apiKey'). */
  apiKey?: string
  /** OAuth config (if authType is 'oauth'). */
  oauth?: {
    clientId: string
    authUrl: string
    tokenUrl: string
    scopes: string[]
  }
}

/**
 * Filesystem source configuration.
 */
export interface FilesystemSourceConfig extends SourceConfig {
  type: 'filesystem'
  /** Root path to expose. */
  rootPath: string
  /** Glob patterns to include. */
  include?: string[]
  /** Glob patterns to exclude. */
  exclude?: string[]
}

/**
 * Union of all source types.
 */
export type AnySourceConfig = McpSourceConfig | ApiSourceConfig | FilesystemSourceConfig

/**
 * MCP tool definition from a source.
 */
export interface McpTool {
  /** Tool name. */
  name: string
  /** Tool description. */
  description: string
  /** JSON schema for input. */
  inputSchema: Record<string, unknown>
}

/**
 * Connected source state.
 */
export interface ConnectedSource {
  /** Source configuration. */
  config: AnySourceConfig
  /** Whether currently connected. */
  connected: boolean
  /** Available tools (for MCP sources). */
  tools?: McpTool[]
  /** Error message if connection failed. */
  error?: string
}
