import { contextBridge, ipcRenderer } from 'electron'

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

/** Source configuration types. */
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

/**
 * Electron API exposed to the renderer process.
 * 
 * SECURITY: Only expose specific functions, never raw ipcRenderer.
 * Always filter event data to prevent leaking the event object.
 */
const electronAPI = {
  /**
   * Send a message to the agent.
   * @param message - The message content to send
   */
  sendMessage: (message: string): Promise<void> => {
    return ipcRenderer.invoke('agent:message', message)
  },

  /**
   * Listen for streamed agent responses.
   * @param callback - Function called with each streamed chunk
   */
  onAgentStream: (callback: (chunk: StreamChunk) => void): void => {
    ipcRenderer.on('agent:stream', (_event, chunk) => callback(chunk))
  },

  /**
   * Remove agent stream listener.
   */
  offAgentStream: (): void => {
    ipcRenderer.removeAllListeners('agent:stream')
  },

  /**
   * Get the current permission mode.
   */
  getPermissionMode: (): Promise<PermissionMode> => {
    return ipcRenderer.invoke('permissions:get-mode')
  },

  /**
   * Set the permission mode.
   * @param mode - The permission mode to set
   */
  setPermissionMode: (mode: PermissionMode): Promise<PermissionMode> => {
    return ipcRenderer.invoke('permissions:set-mode', mode)
  },

  /**
   * Listen for tool approval requests.
   * @param callback - Function called when approval is needed
   */
  onToolApproval: (callback: (request: ToolApprovalRequest) => void): void => {
    ipcRenderer.on('agent:tool-approval', (_event, request) => callback(request))
  },

  /**
   * Remove tool approval listener.
   */
  offToolApproval: (): void => {
    ipcRenderer.removeAllListeners('agent:tool-approval')
  },

  /**
   * Respond to a tool approval request.
   * @param response - The approval response with id and approved status
   */
  respondToolApproval: (response: ToolApprovalResponse): void => {
    ipcRenderer.send('agent:tool-response', response)
  },

  /**
   * Clear the conversation history.
   */
  clearHistory: (): Promise<void> => {
    return ipcRenderer.invoke('agent:clear-history')
  },

  /**
   * Set the project root directory.
   * @param path - Absolute path to project root
   */
  setProjectRoot: (path: string): Promise<void> => {
    return ipcRenderer.invoke('project:set-root', path)
  },

  // Version control methods

  /**
   * Get current version control state.
   */
  getVersionState: (): Promise<VersionState> => {
    return ipcRenderer.invoke('version:get-state')
  },

  /**
   * Get all branches.
   */
  getBranches: (): Promise<Branch[]> => {
    return ipcRenderer.invoke('version:get-branches')
  },

  /**
   * Get commit history.
   * @param depth - Maximum number of commits to return
   */
  getHistory: (depth?: number): Promise<Commit[]> => {
    return ipcRenderer.invoke('version:get-history', depth)
  },

  /**
   * Switch to a branch.
   * @param name - Branch name to switch to
   */
  switchBranch: (name: string): Promise<void> => {
    return ipcRenderer.invoke('version:switch-branch', name)
  },

  /**
   * Create a new branch.
   * @param name - Name for the new branch
   */
  createBranch: (name: string): Promise<Branch> => {
    return ipcRenderer.invoke('version:create-branch', name)
  },

  /**
   * Rollback to a specific commit.
   * @param oid - Commit SHA to rollback to
   */
  rollback: (oid: string): Promise<void> => {
    return ipcRenderer.invoke('version:rollback', oid)
  },

  /**
   * Get diff between two commits.
   * @param from - Source commit SHA
   * @param to - Target commit SHA
   */
  getDiff: (from: string, to: string): Promise<FileDiff[]> => {
    return ipcRenderer.invoke('version:diff', from, to)
  },

  // Sources methods

  /**
   * Get all connected sources with their state.
   */
  getSources: (): Promise<ConnectedSource[]> => {
    return ipcRenderer.invoke('sources:list')
  },

  /**
   * Load all source configurations from disk.
   */
  loadSourceConfigs: (): Promise<SourceConfig[]> => {
    return ipcRenderer.invoke('sources:load-configs')
  },

  /**
   * Save a source configuration.
   * @param config - The source configuration to save
   */
  saveSource: (config: SourceConfig): Promise<void> => {
    return ipcRenderer.invoke('sources:save', config)
  },

  /**
   * Connect to a source by ID.
   * @param id - The source ID to connect
   */
  connectSource: (id: string): Promise<ConnectedSource> => {
    return ipcRenderer.invoke('sources:connect', id)
  },

  /**
   * Disconnect from a source.
   * @param id - The source ID to disconnect
   */
  disconnectSource: (id: string): Promise<void> => {
    return ipcRenderer.invoke('sources:disconnect', id)
  },

  /**
   * Delete a source configuration.
   * @param id - The source ID to delete
   */
  deleteSource: (id: string): Promise<void> => {
    return ipcRenderer.invoke('sources:delete', id)
  },

  // Skills methods

  /**
   * Get all available skills.
   */
  getSkills: (): Promise<Skill[]> => {
    return ipcRenderer.invoke('skills:list')
  },

  /**
   * Get a specific skill by name.
   * @param name - The skill name
   */
  getSkill: (name: string): Promise<Skill | null> => {
    return ipcRenderer.invoke('skills:get', name)
  },

  /**
   * Save a skill.
   * @param skill - The skill to save
   */
  saveSkill: (skill: Skill): Promise<void> => {
    return ipcRenderer.invoke('skills:save', skill)
  },

  /**
   * Delete a skill.
   * @param name - The skill name to delete
   */
  deleteSkill: (name: string): Promise<void> => {
    return ipcRenderer.invoke('skills:delete', name)
  },

  // Config methods

  /**
   * Get the application configuration.
   */
  getConfig: (): Promise<AppConfig> => {
    return ipcRenderer.invoke('config:get')
  },

  /**
   * Save the application configuration.
   * @param config - The configuration to save
   */
  saveConfig: (config: AppConfig): Promise<void> => {
    return ipcRenderer.invoke('config:save', config)
  }
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI
