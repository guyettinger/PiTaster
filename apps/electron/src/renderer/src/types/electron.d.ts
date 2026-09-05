/**
 * Type definitions for the Electron API exposed via preload script.
 */

import type { SubApp, CreateAppParams, AppTemplate, PersistedMessage, ChatHistoryPayload, ChatSession, CreateChatSessionParams, CacheVerdict, DaemonHealth, ElementContext, SerializedContentBlock, Skill, SkillDraft, SkillLibrary, SkillLibraryUpdate, SkillScope, ProviderRequestRecord, RequestOutcome, TelemetrySnapshot, TelemetryTotals, TurnCost, OpenAppsState } from '@pitaster/core'

/**
 * A sampling value as the user configured it.
 *
 * A number pins it; `null` sends nothing and leaves the model's Modelfile default
 * alone; `'auto'` asks Pi Taster to choose from what it knows about the model.
 */
type SamplingSetting = number | 'auto' | null

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** A single streamed update from the agent to the renderer. */
interface StreamChunk {
  /** Type of chunk. */
  type:
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'complete'
    | 'error'
    | 'status'
  /** Text content (for 'text' and 'thinking' types). */
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
  /** What the agent is doing (for 'status' type). */
  status?: AgentStatus
  /** What the finished turn cost (for 'complete' type). */
  turn?: TurnCost
  /** What the daemon did with the prefix on the turn's last request. */
  cache?: CacheVerdict
  /** What a write actually changed (for 'tool_end' on a file-modifying tool). */
  patches?: FilePatch[]
}

/** What one write changed, as a diff the UI can render. */
interface FilePatch {
  /** Path to the changed file, relative to the app root. */
  path: string
  /** The change as a unified diff, ready to render. */
  patch: string
  /** Lines added. */
  added: number
  /** Lines removed. */
  removed: number
  /** Whether the diff was cut short to keep it renderable. */
  truncated: boolean
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

/** Where the context window number came from. */
type ContextWindowSource = 'user' | 'daemon' | 'fallback'

/** Which half of the window a block sits in. */
type ContextBlockGroup = 'fixed' | 'conversation'

/** One attributable slice of the context window. */
interface ContextBlock {
  /** Stable identifier, used as a React key and to select the block's fill. */
  id: string
  /** Human label, e.g. `Tool results`. */
  label: string
  /** Which half of the bar this belongs to. */
  group: ContextBlockGroup
  /** Estimated tokens this block occupies. */
  tokens: number
  /** Secondary text, e.g. `23 calls`. */
  detail?: string
}

/** A single large tool result, named so it can be recognized. */
interface ContextHotspot {
  /** What produced it, e.g. `read src/App.tsx`. */
  label: string
  /** Estimated tokens it occupies. */
  tokens: number
}

/** How confident a {@link ContextReport} is about its own numbers. */
type ContextReportState = 'live' | 'estimated' | 'stale' | 'floor'

/** What the context window is holding, and how much of it is worth acting on. */
interface ContextReport {
  /** How much of this report is measured rather than estimated. */
  state: ContextReportState
  /** The provider's own token count, or null when there is not one. */
  measured: number | null
  /** Sum of {@link blocks}. Always an estimate. */
  estimated: number
  /** Tokens the model will actually accept. */
  window: number
  /** Where {@link window} came from. */
  windowSource: ContextWindowSource
  /** Token count at which the agent stops to summarize. */
  compactAt: number
  /** The attribution, largest first within each group. */
  blocks: ContextBlock[]
  /** The largest individual tool results, descending, at most three. */
  hotspots: ContextHotspot[]
  /** Measured prefill rate in tokens per second, or null before there is a sample. */
  prefillRate: number | null
}

/** Tool approval request sent to renderer. */
interface ToolApprovalRequest {
  id: string
  tool: string
  input: Record<string, unknown>
  /** What the write would change, where that can be known exactly. */
  patches?: FilePatch[]
  /** Advisory note about what the call does, e.g. that it reaches the network. */
  notice?: string
}

/** One entry in a sub-app's file tree. */
export interface FileNode {
  /** Path relative to the app root, with forward slashes. */
  path: string
  /** The file or directory name alone. */
  name: string
  /** What it is. */
  kind: 'file' | 'directory'
  /** Children, for a directory. */
  children?: FileNode[]
}

/** One compiler error, as the viewer draws it. */
export interface FileDiagnostic {
  /** Path relative to the app root. */
  path: string
  /** 1-indexed line. */
  line: number
  /** 1-indexed column. */
  column: number
  /** The TypeScript error number. */
  code: number
  /** The flattened message. */
  message: string
  /** How serious the compiler considers it. */
  category: 'error' | 'warning'
}

/** A file's contents, as the viewer needs them. */
export interface FileContents {
  /** Path relative to the app root. */
  path: string
  /** The file's text. */
  text: string
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
  samplingTemperature: SamplingSetting
  /** Nucleus cutoff, in the same three states as {@link samplingTemperature}. */
  samplingTopP: SamplingSetting
  /**
   * How hard to ask the model to think.
   *
   * `unset` sends no `reasoning_effort`, which is not the same as off: Ollama's
   * models reason regardless, and its OpenAI-compatible endpoint has no switch that
   * stops them.
   */
  reasoningLevel: 'unset' | 'low' | 'medium' | 'high'
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
  /** The window Pi Taster actually configures, probed from the daemon when it can be. */
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
  onAgentStream: (appId: string, callback: (chunk: StreamChunk) => void) => () => void
  /** Get the current permission mode. */
  getPermissionMode: () => Promise<PermissionMode>
  /** Set the permission mode. */
  setPermissionMode: (mode: PermissionMode) => Promise<PermissionMode>
  /** Listen for tool approval requests. */
  onToolApproval: (
    appId: string,
    callback: (request: ToolApprovalRequest) => void
  ) => () => void
  /** Respond to a tool approval request. */
  respondToolApproval: (response: ToolApprovalResponse) => void
  /** Clear the conversation history. */
  clearHistory: () => Promise<void>

  /** Cancel the in-flight agent run. */
  abortAgent: () => Promise<void>

  /** Read what the context window holds, broken down into attributable blocks. */
  getContextReport: () => Promise<ContextReport | null>
  /** Read what the session's provider requests actually cost. */
  getTelemetry: () => Promise<TelemetrySnapshot>

  /** Summarize the conversation now rather than waiting for the threshold. */
  compactContext: () => Promise<void>
  
  // Version control methods
  /** Get current version control state. */
  getVersionState: (appId: string) => Promise<VersionState>
  /** Get all branches. */
  getBranches: (appId: string) => Promise<Branch[]>
  /** Get commit history. */
  getHistory: (depth: number | undefined, appId: string) => Promise<Commit[]>
  /** Switch to a branch. */
  switchBranch: (name: string, appId: string) => Promise<void>
  /** Create a new branch. */
  createBranch: (name: string, appId: string) => Promise<Branch>
  /** Rollback to a specific commit. */
  rollback: (oid: string, appId: string) => Promise<void>
  /** Get diff between two commits. */
  getDiff: (from: string, to: string, appId: string) => Promise<FileDiff[]>

  /**
   * The commit a chat session started from, for the changed-files strip.
   * @param appId - The app the session belongs to
   * @param sessionId - The session to ask about
   * @returns The baseline commit oid, or null when one could not be recorded
   */
  getSessionBaseline: (appId: string, sessionId: string) => Promise<string | null>

  /** List the sub-app's source files as a tree. */
  getFileTree: (appId: string) => Promise<FileNode[]>
  /** Read one file from inside the sub-app. */
  readFile: (filePath: string, appId: string) => Promise<FileContents>
  /** Compiler errors for one file, from the agent's own language service. */
  getFileDiagnostics: (filePath: string, appId: string) => Promise<FileDiagnostic[]>

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
  /** Get both skill libraries for the open app. */
  getSkills: () => Promise<SkillLibrary>
  /** Create or overwrite a skill. */
  saveSkill: (request: { scope: SkillScope; draft: SkillDraft }) => Promise<SkillLibraryUpdate>
  /** Delete a skill and its directory. */
  deleteSkill: (request: { scope: SkillScope; name: string }) => Promise<SkillLibraryUpdate>
  /** Turn a skill on or off for the open app. */
  setSkillEnabled: (request: { name: string; enabled: boolean }) => Promise<SkillLibrary>
  /** Listen for the skill libraries changing on disk. */
  onSkillsChanged: (appId: string | null, callback: () => void) => () => void

  // Workspace layout methods
  /** Read a sub-app's saved dock layout, or null when there is nothing usable. */
  getWorkspaceLayout: (appId: string, version: number) => Promise<unknown | null>
  /** Save a sub-app's dock layout. */
  saveWorkspaceLayout: (appId: string, version: number, layout: unknown) => Promise<void>

  // Open-app set methods
  /** Read which apps have a rail tile, already pruned of apps that no longer exist. */
  getOpenApps: () => Promise<OpenAppsState>
  /** Persist which apps have a rail tile, and which one has focus. */
  setOpenApps: (state: OpenAppsState) => Promise<void>

  // Config methods
  /** Get the application configuration. */
  getConfig: () => Promise<AppConfig>
  /** Save the application configuration. */
  saveConfig: (config: AppConfig) => Promise<void>

  /** List the models pulled into the local Ollama daemon. */
  /** Whether the daemon answers, and whether it still holds the selected model. */
  getDaemonHealth: () => Promise<DaemonHealth>
  listModels: () => Promise<OllamaModel[]>

  /** Check whether an Ollama daemon is answering. */
  checkModelConnection: (baseUrl?: string) => Promise<boolean>

  // Chat history methods
  /** Load chat history for the active app, tagged with the session it belongs to. */
  loadChatHistory: () => Promise<ChatHistoryPayload>
  /** Clear chat history for the active app. */
  clearChatHistory: () => Promise<void>
  /** Listen for chat history loaded events. */
  onChatHistoryLoaded: (
    appId: string,
    callback: (payload: ChatHistoryPayload) => void
  ) => () => void

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
  onChatSessionChanged: (
    appId: string,
    callback: (sessionId: string | null) => void
  ) => () => void
  /** Listen for sessions list updates. */
  onSessionsListUpdated: (
    appId: string,
    callback: (sessions: ChatSession[]) => void
  ) => () => void

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
  onAppLog: (callback: (entry: AppLogEntry) => void) => () => void
  /** Listen for app status changes. */
  onAppStatusChange: (callback: (change: AppStatusChange) => void) => () => void

  // Inspector methods
  /** Get the inspector overlay script. */
  getInspectorScript: () => Promise<string>
  /** Capture element screenshot and info. */
  captureElement: (elementInfo: ElementInfo) => Promise<ElementContext>
  /** Add element context to the current chat. */
  addElementContext: (context: ElementContext) => Promise<void>
  /** Listen for element context added events. */
  onElementContextAdded: (
    appId: string,
    callback: (context: ElementContext) => void
  ) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type { 
  PermissionMode, 
  SamplingSetting,
  StreamChunk,
  AgentStatus,
  CacheVerdict,
  DaemonHealth,
  TurnCost,
  TelemetrySnapshot,
  ProviderRequestRecord,
  RequestOutcome,
  TelemetryTotals,
  ContextUsage, 
  ContextBlock,
  ContextBlockGroup,
  ContextHotspot,
  ContextReport,
  ContextReportState,
  ContextWindowSource,
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
  SkillDraft,
  SkillLibrary,
  SkillLibraryUpdate,
  SkillScope,
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
