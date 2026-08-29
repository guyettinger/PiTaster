/**
 * Type definitions for the Electron API exposed via preload script.
 */

import type { SubApp, CreateAppParams, AppTemplate, PersistedMessage, ChatSession, CreateChatSessionParams, ElementContext, SerializedContentBlock } from '@anyapp/core'

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Stream chunk from agent response. */
interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit'
  text?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
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

/** Status change event. */
interface AppStatusChange {
  appId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  url?: string
  port?: number
  error?: string
}

/** Element info from inspector overlay. */
interface ElementInfo {
  /** Tag name (e.g., 'button', 'div'). */
  tag: string
  /** Element text content (trimmed). */
  text: string
  /** CSS classes. */
  classes: string[]
  /** ID attribute. */
  id?: string
  /** Data attributes. */
  dataAttributes: Record<string, string>
  /** Computed styles (selected properties). */
  styles: {
    position: string
    display: string
    width: string
    height: string
    backgroundColor?: string
    color?: string
  }
  /** Bounding rect relative to viewport. */
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  /** XPath selector for the element. */
  xpath: string
  /** CSS selector (best attempt). */
  selector: string
}

/** Electron API interface exposed to the renderer. */
interface ElectronAPI {
  /** Send a message to the agent (string or content blocks). */
  sendMessage: (message: string | SerializedContentBlock[]) => Promise<void>
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
  getVersionState: (appPath?: string) => Promise<VersionState>
  /** Get all branches. */
  getBranches: (appPath?: string) => Promise<Branch[]>
  /** Get commit history. */
  getHistory: (depth?: number, appPath?: string) => Promise<Commit[]>
  /** Switch to a branch. */
  switchBranch: (name: string, appPath?: string) => Promise<void>
  /** Create a new branch. */
  createBranch: (name: string, appPath?: string) => Promise<Branch>
  /** Rollback to a specific commit. */
  rollback: (oid: string, appPath?: string) => Promise<void>
  /** Get diff between two commits. */
  getDiff: (from: string, to: string, appPath?: string) => Promise<FileDiff[]>

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

  // Chat history methods
  /** Load chat history for the active app. */
  loadChatHistory: () => Promise<PersistedMessage[]>
  /** Save a chat message to history. */
  saveChatMessage: (message: PersistedMessage) => Promise<void>
  /** Clear chat history for the active app. */
  clearChatHistory: () => Promise<void>
  /** Listen for chat history loaded events. */
  onChatHistoryLoaded: (callback: (messages: PersistedMessage[]) => void) => void
  /** Remove chat history loaded listener. */
  offChatHistoryLoaded: () => void

  // Chat session methods
  /** List all chat sessions for the active app. */
  listChatSessions: () => Promise<ChatSession[]>
  /** Create a new chat session. */
  createChatSession: (params?: CreateChatSessionParams) => Promise<ChatSession>
  /** Delete a chat session. */
  deleteChatSession: (sessionId: string) => Promise<void>
  /** Rename a chat session. */
  renameChatSession: (sessionId: string, title: string) => Promise<ChatSession>
  /** Set the active chat session. */
  setActiveChatSession: (sessionId: string) => Promise<void>
  /** Get the active chat session ID. */
  getActiveChatSession: () => Promise<string | null>
  /** Listen for session change events. */
  onChatSessionChanged: (callback: (sessionId: string | null) => void) => void
  /** Remove session change listener. */
  offChatSessionChanged: () => void
  /** Listen for sessions list updates. */
  onSessionsListUpdated: (callback: (sessions: ChatSession[]) => void) => void
  /** Remove sessions list update listener. */
  offSessionsListUpdated: () => void

  // Apps methods
  /** List all sub-apps. */
  listApps: () => Promise<SubApp[]>
  /** Create a new sub-app from template. */
  createApp: (params: CreateAppParams) => Promise<SubApp>
  /** Delete a sub-app by ID. */
  deleteApp: (id: string) => Promise<void>
  /** Get a single sub-app by ID. */
  getApp: (id: string) => Promise<SubApp | null>
  /** Update a sub-app's metadata. */
  updateApp: (id: string, updates: { name?: string; description?: string }) => Promise<SubApp>
  /** Set the active app for agent context. */
  setActiveApp: (id: string | null) => Promise<string | null>
  /** Get the active app ID. */
  getActiveApp: () => Promise<string | null>
  /** Get the active app details. */
  getActiveAppDetails: () => Promise<SubApp | null>

  // App runner methods
  /** Run a sub-app's dev server. */
  runApp: (id: string) => Promise<RunningApp>
  /** Stop a running app. */
  stopApp: (id: string) => Promise<void>
  /** Get all running apps. */
  getRunningApps: () => Promise<RunningApp[]>
  /** Check if an app is running. */
  isAppRunning: (id: string) => Promise<boolean>
  /** Get running info for an app. */
  getRunningAppInfo: (id: string) => Promise<RunningApp | null>
  /** Open a running app in browser. */
  openInBrowser: (id: string) => Promise<void>
  /** Install dependencies for an app. */
  installDeps: (id: string) => Promise<void>
  /** Listen for app log events. */
  onAppLog: (callback: (entry: AppLogEntry) => void) => void
  /** Remove app log listener. */
  offAppLog: () => void
  /** Listen for app status changes. */
  onAppStatusChange: (callback: (change: AppStatusChange) => void) => void
  /** Remove app status change listener. */
  offAppStatusChange: () => void

  // Inspector methods
  /** Get the inspector overlay script. */
  getInspectorScript: () => Promise<string>
  /** Capture element screenshot and info. */
  captureElement: (elementInfo: ElementInfo) => Promise<ElementContext>
  /** Add element context to the current chat. */
  addElementContext: (context: ElementContext) => Promise<void>
  /** Listen for element context added events. */
  onElementContextAdded: (callback: (context: ElementContext) => void) => () => void
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
  AppConfig,
  RunningApp,
  AppLogEntry,
  AppStatusChange,
  SubApp,
  CreateAppParams,
  AppTemplate,
  PersistedMessage,
  ChatSession,
  CreateChatSessionParams
}
