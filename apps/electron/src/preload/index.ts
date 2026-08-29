import { contextBridge, ipcRenderer } from 'electron'

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Stream chunk from agent response. */
interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit'
  text?: string
  tool?: string
  error?: string
  /** Seconds until retry (for 'rate_limit' type). */
  retryAfterSeconds?: number
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

/** App template types. */
type AppTemplate = 'react-vite' | 'node-cli' | 'node-server' | 'static-site' | 'blank'

/** Sub-app definition. */
interface SubApp {
  id: string
  name: string
  description: string
  template: AppTemplate
  status: 'ready' | 'creating' | 'error' | 'building'
  path: string
  createdAt: string
  updatedAt: string
  currentBranch?: string
  hasChanges?: boolean
}

/** Parameters for creating a new sub-app. */
interface CreateAppParams {
  name: string
  description?: string
  template: AppTemplate
}

/** Running app state. */
interface RunningApp {
  appId: string
  pid: number
  url: string | null
  port: number
  startedAt: string
}

/** App log entry. */
interface AppLogEntry {
  appId: string
  timestamp: string
  type: 'stdout' | 'stderr' | 'system'
  message: string
}

/** Status change event for running apps. */
interface AppStatusChange {
  appId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  url?: string
  port?: number
  error?: string
}

/** Serialized text content block. */
interface SerializedTextBlock {
  type: 'text'
  content: string
}

/** Serialized tool execution block. */
interface SerializedToolBlock {
  type: 'tool'
  name: string
  input?: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  error?: string
}

/** Serialized approval record block. */
interface SerializedApprovalBlock {
  type: 'approval'
  tool: string
  input: Record<string, unknown>
  approved: boolean
}

/** Union of all serializable content block types. */
type SerializedContentBlock = SerializedTextBlock | SerializedToolBlock | SerializedApprovalBlock

/** A persisted chat message. */
interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: SerializedContentBlock[]
  timestamp: string
}

/** A chat session within an app. */
interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** Parameters for creating a new chat session. */
interface CreateChatSessionParams {
  title?: string
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
   * @param message - The message content (string or content blocks)
   */
  sendMessage: (message: string | SerializedContentBlock[]): Promise<void> => {
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
   * @param appPath - Optional app path (defaults to active app)
   */
  getVersionState: (appPath?: string): Promise<VersionState> => {
    return ipcRenderer.invoke('version:get-state', appPath)
  },

  /**
   * Get all branches.
   * @param appPath - Optional app path (defaults to active app)
   */
  getBranches: (appPath?: string): Promise<Branch[]> => {
    return ipcRenderer.invoke('version:get-branches', appPath)
  },

  /**
   * Get commit history.
   * @param depth - Maximum number of commits to return
   * @param appPath - Optional app path (defaults to active app)
   */
  getHistory: (depth?: number, appPath?: string): Promise<Commit[]> => {
    return ipcRenderer.invoke('version:get-history', depth, appPath)
  },

  /**
   * Switch to a branch.
   * @param name - Branch name to switch to
   * @param appPath - Optional app path (defaults to active app)
   */
  switchBranch: (name: string, appPath?: string): Promise<void> => {
    return ipcRenderer.invoke('version:switch-branch', name, appPath)
  },

  /**
   * Create a new branch.
   * @param name - Name for the new branch
   * @param appPath - Optional app path (defaults to active app)
   */
  createBranch: (name: string, appPath?: string): Promise<Branch> => {
    return ipcRenderer.invoke('version:create-branch', name, appPath)
  },

  /**
   * Rollback to a specific commit.
   * @param oid - Commit SHA to rollback to
   * @param appPath - Optional app path (defaults to active app)
   */
  rollback: (oid: string, appPath?: string): Promise<void> => {
    return ipcRenderer.invoke('version:rollback', oid, appPath)
  },

  /**
   * Get diff between two commits.
   * @param from - Source commit SHA
   * @param to - Target commit SHA
   * @param appPath - Optional app path (defaults to active app)
   */
  getDiff: (from: string, to: string, appPath?: string): Promise<FileDiff[]> => {
    return ipcRenderer.invoke('version:diff', from, to, appPath)
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
  },

  // Chat history methods

  /**
   * Load chat history for the active app.
   */
  loadChatHistory: (): Promise<PersistedMessage[]> => {
    return ipcRenderer.invoke('chat:load-history')
  },

  /**
   * Save a chat message to history.
   * @param message - The message to save
   */
  saveChatMessage: (message: PersistedMessage): Promise<void> => {
    return ipcRenderer.invoke('chat:save-message', message)
  },

  /**
   * Clear chat history for the active app.
   */
  clearChatHistory: (): Promise<void> => {
    return ipcRenderer.invoke('chat:clear-history')
  },

  /**
   * Listen for chat history loaded events.
   * @param callback - Function called with the loaded messages
   */
  onChatHistoryLoaded: (callback: (messages: PersistedMessage[]) => void): void => {
    ipcRenderer.on('chat:history-loaded', (_event, messages) => callback(messages))
  },

  /**
   * Remove chat history loaded listener.
   */
  offChatHistoryLoaded: (): void => {
    ipcRenderer.removeAllListeners('chat:history-loaded')
  },

  // Chat session methods

  /**
   * List all chat sessions for the active app.
   */
  listChatSessions: (): Promise<ChatSession[]> => {
    return ipcRenderer.invoke('sessions:list')
  },

  /**
   * Create a new chat session.
   * @param params - Optional creation parameters
   */
  createChatSession: (params?: CreateChatSessionParams): Promise<ChatSession> => {
    return ipcRenderer.invoke('sessions:create', params)
  },

  /**
   * Delete a chat session.
   * @param sessionId - The session ID to delete
   */
  deleteChatSession: (sessionId: string): Promise<void> => {
    return ipcRenderer.invoke('sessions:delete', sessionId)
  },

  /**
   * Rename a chat session.
   * @param sessionId - The session ID to rename
   * @param title - The new title
   */
  renameChatSession: (sessionId: string, title: string): Promise<ChatSession> => {
    return ipcRenderer.invoke('sessions:rename', sessionId, title)
  },

  /**
   * Set the active chat session.
   * @param sessionId - The session ID to activate
   */
  setActiveChatSession: (sessionId: string): Promise<void> => {
    return ipcRenderer.invoke('sessions:set-active', sessionId)
  },

  /**
   * Get the active chat session ID.
   */
  getActiveChatSession: (): Promise<string | null> => {
    return ipcRenderer.invoke('sessions:get-active')
  },

  /**
   * Listen for session change events.
   * @param callback - Function called when the active session changes
   */
  onChatSessionChanged: (callback: (sessionId: string | null) => void): void => {
    ipcRenderer.on('chat:session-changed', (_event, sessionId) => callback(sessionId))
  },

  /**
   * Remove session change listener.
   */
  offChatSessionChanged: (): void => {
    ipcRenderer.removeAllListeners('chat:session-changed')
  },

  /**
   * Listen for sessions list updates.
   * @param callback - Function called when the sessions list changes
   */
  onSessionsListUpdated: (callback: (sessions: ChatSession[]) => void): void => {
    ipcRenderer.on('sessions:list-updated', (_event, sessions) => callback(sessions))
  },

  /**
   * Remove sessions list update listener.
   */
  offSessionsListUpdated: (): void => {
    ipcRenderer.removeAllListeners('sessions:list-updated')
  },

  // App management methods

  /**
   * List all sub-apps.
   */
  listApps: (): Promise<SubApp[]> => {
    return ipcRenderer.invoke('apps:list')
  },

  /**
   * Get a sub-app by ID.
   * @param id - The app ID
   */
  getApp: (id: string): Promise<SubApp | null> => {
    return ipcRenderer.invoke('apps:get', id)
  },

  /**
   * Create a new sub-app from template.
   * @param params - Creation parameters
   */
  createApp: (params: CreateAppParams): Promise<SubApp> => {
    return ipcRenderer.invoke('apps:create', params)
  },

  /**
   * Delete a sub-app.
   * @param id - The app ID to delete
   */
  deleteApp: (id: string): Promise<void> => {
    return ipcRenderer.invoke('apps:delete', id)
  },

  /**
   * Update a sub-app's metadata.
   * @param id - The app ID
   * @param updates - Fields to update
   */
  updateApp: (id: string, updates: { name?: string; description?: string }): Promise<SubApp> => {
    return ipcRenderer.invoke('apps:update', id, updates)
  },

  /**
   * Set the active app for agent context.
   * @param id - The app ID to set as active, or null to clear
   */
  setActiveApp: (id: string | null): Promise<string | null> => {
    return ipcRenderer.invoke('apps:set-active', id)
  },

  /**
   * Get the active app ID.
   */
  getActiveApp: (): Promise<string | null> => {
    return ipcRenderer.invoke('apps:get-active')
  },

  /**
   * Get the active app details.
   */
  getActiveAppDetails: (): Promise<SubApp | null> => {
    return ipcRenderer.invoke('apps:get-active-details')
  },

  // App runner methods

  /**
   * Run a sub-app's dev server.
   * @param id - The app ID to run
   */
  runApp: (id: string): Promise<RunningApp> => {
    return ipcRenderer.invoke('apps:run', id)
  },

  /**
   * Stop a running app.
   * @param id - The app ID to stop
   */
  stopApp: (id: string): Promise<void> => {
    return ipcRenderer.invoke('apps:stop', id)
  },

  /**
   * Get all running apps.
   */
  getRunningApps: (): Promise<RunningApp[]> => {
    return ipcRenderer.invoke('apps:get-running')
  },

  /**
   * Check if an app is running.
   * @param id - The app ID to check
   */
  isAppRunning: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke('apps:is-running', id)
  },

  /**
   * Get running info for an app.
   * @param id - The app ID
   */
  getRunningAppInfo: (id: string): Promise<RunningApp | null> => {
    return ipcRenderer.invoke('apps:get-running-info', id)
  },

  /**
   * Open a running app in the default browser.
   * @param id - The app ID to open
   */
  openInBrowser: (id: string): Promise<void> => {
    return ipcRenderer.invoke('apps:open-browser', id)
  },

  /**
   * Install dependencies for an app.
   * @param id - The app ID
   */
  installDeps: (id: string): Promise<void> => {
    return ipcRenderer.invoke('apps:install-deps', id)
  },

  /**
   * Listen for app log events.
   * @param callback - Function called with each log entry
   */
  onAppLog: (callback: (entry: AppLogEntry) => void): void => {
    ipcRenderer.on('apps:log', (_event, entry) => callback(entry))
  },

  /**
   * Remove app log listener.
   */
  offAppLog: (): void => {
    ipcRenderer.removeAllListeners('apps:log')
  },

  /**
   * Listen for app status changes.
   * @param callback - Function called with status changes
   */
  onAppStatusChange: (callback: (change: AppStatusChange) => void): void => {
    ipcRenderer.on('apps:status-change', (_event, change) => callback(change))
  },

  /**
   * Remove app status change listener.
   */
  offAppStatusChange: (): void => {
    ipcRenderer.removeAllListeners('apps:status-change')
  },

  // Inspector methods

  /**
   * Get the inspector overlay script.
   */
  getInspectorScript: (): Promise<string> => {
    return ipcRenderer.invoke('inspector:get-script')
  },

  /**
   * Capture element screenshot and info.
   */
  captureElement: (elementInfo: any): Promise<any> => {
    return ipcRenderer.invoke('inspector:capture-element', elementInfo)
  },

  /**
   * Add element context to the current chat.
   */
  addElementContext: (context: any): Promise<void> => {
    return ipcRenderer.invoke('chat:add-element-context', context)
  },

  /**
   * Listen for element context added events.
   */
  onElementContextAdded: (callback: (context: any) => void): (() => void) => {
    const handler = (_event: any, context: any) => callback(context)
    ipcRenderer.on('chat:element-context-added', handler)
    return () => ipcRenderer.removeListener('chat:element-context-added', handler)
  }
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI
