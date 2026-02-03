/**
 * Type definitions for the Electron API exposed via preload script.
 */

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Stream chunk from agent response. */
interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  text?: string
  tool?: string
  error?: string
}

/** Tool approval request sent to renderer. */
interface ToolApprovalRequest {
  id: string
  tool: string
  input: Record<string, unknown>
}

/** Tool approval response from renderer. */
interface ToolApprovalResponse {
  id: string
  approved: boolean
}

/** Git commit info. */
interface Commit {
  oid: string
  message: string
  author: string
  timestamp: string
  parents: string[]
}

/** Git branch info. */
interface Branch {
  name: string
  head: string
  isCurrent: boolean
}

/** Version control state. */
interface VersionState {
  currentBranch: string
  head: string
  hasChanges: boolean
  modifiedFiles: string[]
}

/** File diff between commits. */
interface FileDiff {
  path: string
  type: 'add' | 'modify' | 'delete'
  oldContent?: string
  newContent?: string
}

/** MCP tool definition. */
interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Source configuration. */
interface SourceConfig {
  id: string
  name: string
  type: 'mcp' | 'api' | 'filesystem'
  enabled: boolean
  createdAt: string
}

/** Connected source state. */
interface ConnectedSource {
  config: SourceConfig
  connected: boolean
  tools?: McpTool[]
  error?: string
}

/** Skill definition. */
interface Skill {
  name: string
  description: string
  content: string
  filepath: string
}

/** Application configuration. */
interface AppConfig {
  anthropicApiKey?: string
  theme: 'light' | 'dark' | 'system'
  autoCommit: boolean
}

/** Electron API interface exposed to the renderer. */
interface ElectronAPI {
  /** Send a message to the agent. */
  sendMessage: (message: string) => Promise<void>
  /** Listen for streamed agent responses. */
  onAgentStream: (callback: (chunk: StreamChunk) => void) => void
  /** Remove agent stream listener. */
  offAgentStream: () => void
  /** Get the current permission mode. */
  getPermissionMode: () => Promise<PermissionMode>
  /** Set the permission mode. */
  setPermissionMode: (mode: PermissionMode) => Promise<PermissionMode>
  /** Listen for tool approval requests. */
  onToolApproval: (callback: (request: ToolApprovalRequest) => void) => void
  /** Remove tool approval listener. */
  offToolApproval: () => void
  /** Respond to a tool approval request. */
  respondToolApproval: (response: ToolApprovalResponse) => void
  /** Clear the conversation history. */
  clearHistory: () => Promise<void>
  /** Set the project root directory. */
  setProjectRoot: (path: string) => Promise<void>
  
  // Version control methods
  /** Get current version control state. */
  getVersionState: () => Promise<VersionState>
  /** Get all branches. */
  getBranches: () => Promise<Branch[]>
  /** Get commit history. */
  getHistory: (depth?: number) => Promise<Commit[]>
  /** Switch to a branch. */
  switchBranch: (name: string) => Promise<void>
  /** Create a new branch. */
  createBranch: (name: string) => Promise<Branch>
  /** Rollback to a specific commit. */
  rollback: (oid: string) => Promise<void>
  /** Get diff between two commits. */
  getDiff: (from: string, to: string) => Promise<FileDiff[]>

  // Sources methods
  /** Get all connected sources with their state. */
  getSources: () => Promise<ConnectedSource[]>
  /** Load all source configurations from disk. */
  loadSourceConfigs: () => Promise<SourceConfig[]>
  /** Save a source configuration. */
  saveSource: (config: SourceConfig) => Promise<void>
  /** Connect to a source by ID. */
  connectSource: (id: string) => Promise<ConnectedSource>
  /** Disconnect from a source. */
  disconnectSource: (id: string) => Promise<void>
  /** Delete a source configuration. */
  deleteSource: (id: string) => Promise<void>

  // Skills methods
  /** Get all available skills. */
  getSkills: () => Promise<Skill[]>
  /** Get a specific skill by name. */
  getSkill: (name: string) => Promise<Skill | null>
  /** Save a skill. */
  saveSkill: (skill: Skill) => Promise<void>
  /** Delete a skill. */
  deleteSkill: (name: string) => Promise<void>

  // Config methods
  /** Get the application configuration. */
  getConfig: () => Promise<AppConfig>
  /** Save the application configuration. */
  saveConfig: (config: AppConfig) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type { 
  PermissionMode, 
  StreamChunk, 
  ToolApprovalRequest, 
  ToolApprovalResponse,
  Commit,
  Branch,
  VersionState,
  FileDiff,
  McpTool,
  SourceConfig,
  ConnectedSource,
  Skill,
  AppConfig
}
