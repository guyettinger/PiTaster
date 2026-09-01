/**
 * Type definitions for the Electron API exposed via preload script.
 */

import type { SubApp, CreateAppParams, AppTemplate, PersistedMessage, ChatHistoryPayload, ChatSession, CreateChatSessionParams, ElementContext, SerializedContentBlock } from '@anyapp/core'

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** A single streamed update from the agent to the renderer. */
interface StreamChunk {
  /** Type of chunk. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit' | 'status'
  /** Text content (for 'text' type). */
  text?: string
  /** Tool name (for 'tool_start' and 'tool_end' types). */
  tool?: string
  /** Stable identifier correlating a 'tool_start' with its 'tool_end'. */
  toolCallId?: string
  /** Tool arguments (for 'tool_start' type). */
  input?: Record<string, unknown>
  /** Truncated tool output (for 'tool_end' type). */
  output?: string
  /** Error message (for 'error' type, or a failed 'tool_end'). */
  error?: string
  /** Seconds until retry (for 'rate_limit' type). */
  retryAfterSeconds?: number
  /** What the agent is doing (for 'status' type). */
  status?: AgentStatus
  /** Context consumed after this turn, when Pi has reported usage. */
  contextUsage?: ContextUsage
}

/** What the agent is doing when it is not producing tokens. */
interface AgentStatus {
  /** What the agent is doing. */
  kind: 'compacting' | 'retrying' | 'waiting' | 'settled'
  /** One sentence for the user, when there is something worth saying. */
  detail?: string
  /** Retry attempt in progress, 1-indexed. */
  attempt?: number
  /** Retries the policy allows. */
  maxAttempts?: number
}

/** How much of the context window the conversation currently occupies. */
interface ContextUsage {
  /** Tokens the conversation currently occupies. */
  used: number
  /** Tokens the model will actually accept. */
  window: number
}

/** Tool approval request sent to renderer. */
interface ToolApprovalRequest {
  id: string
  tool: string
  input: Record<string, unknown>
  /** Advisory note about what the call does, e.g. that it reaches the network. */
  notice?: string
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
  /** Ollama daemon base URL, without the `/v1` suffix. */
  ollamaBaseUrl: string
  /** Selected model tag, for example `qwen3-coder:30b`, or null when none is chosen. */
  ollamaModel: string | null
  /** UI colour theme. */
  theme: 'light' | 'dark' | 'system'
  /** Whether agent file writes auto-commit to git. */
  autoCommit: boolean
  /** Whether a new chat is named by the local model after its first turn. */
  autoTitleChats: boolean
  /** Context window to configure for the selected model, or null to discover it. */
  contextWindow: number | null
  /** Which tools the agent exposes; 'auto' picks from the context window. */
  toolProfile: 'auto' | 'lean' | 'full'
  /** Whether to shape the context sent to the model. */
  trimContext: boolean
  /** Sampling temperature for the model, or null for the model's own default. */
  samplingTemperature: number | null
}

/** A model pulled into the local Ollama instance. */
interface OllamaModel {
  /** Model tag as Ollama reports it, for example `qwen3-coder:30b`. */
  id: string
  /** Parameter size string reported by Ollama, for example `30.5B`. */
  parameterSize?: string
  /** Size on disk in bytes. */
  sizeBytes?: number
  /** Context window the model's metadata advertises: its architectural maximum. */
  contextWindow: number
  /** The window anyapp actually configures, probed from the daemon when it can be. */
  effectiveContextWindow: number
  /** Where the effective window came from. */
  contextWindowSource: 'user' | 'daemon' | 'fallback'
  /** Whether the model supports function calling. The agent's tools require it. */
  supportsTools: boolean
  /** Whether the model accepts image input. */
  supportsVision: boolean
  /** Whether the model exposes extended thinking. */
  supportsThinking: boolean
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

  /** Cancel the in-flight agent run. */
  abortAgent: () => Promise<void>

  /** Read how full the context window is, without waiting for a turn to finish. */
  getContextUsage: () => Promise<ContextUsage | null>
  
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

  /** List the models pulled into the local Ollama daemon. */
  listModels: () => Promise<OllamaModel[]>

  /** Check whether an Ollama daemon is answering. */
  checkModelConnection: (baseUrl?: string) => Promise<boolean>

  // Chat history methods
  /** Load chat history for the active app, tagged with the session it belongs to. */
  loadChatHistory: () => Promise<ChatHistoryPayload>
  /** Clear chat history for the active app. */
  clearChatHistory: () => Promise<void>
  /** Listen for chat history loaded events. */
  onChatHistoryLoaded: (callback: (payload: ChatHistoryPayload) => void) => void
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
  /** Open an external `http:`/`https:` link in the user's default browser. */
  openExternalUrl: (url: string) => Promise<void>
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
  AgentStatus,
  ContextUsage, 
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
  OllamaModel,
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
