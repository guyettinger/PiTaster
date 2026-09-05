import { contextBridge, ipcRenderer } from 'electron'

/** Permission mode type for tool execution. */
type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** The shell's open-app set — which sub-apps have a rail tile, and which is focused. */
interface OpenAppsState {
  /** Ids of the apps with a tile in the rail, in rail order. */
  openAppIds: string[]
  /** The id of the app whose workspace is focused, or null for none. */
  focusedAppId: string | null
}

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

/** What the daemon did with the prompt prefix it was sent. */
type CacheVerdict = 'cold' | 'reused' | 'compacted' | 'invalidated' | 'unknown'

/** What one turn cost. */
interface TurnCost {
  /** Provider requests in the turn. */
  requests: number
  /** Prompt tokens sent, prefilled and reused together. */
  promptTokens: number
  /** Prompt tokens the daemon had to prefill. */
  prefilledTokens: number
  /** Tokens generated. */
  outputTokens: number
  /** Of those, the ones spent thinking. 0 on Ollama, which does not report it. */
  reasoningTokens: number
  /** Requests that re-prefilled a prefix they had already sent. */
  rePrefills: number
  /** Wall time from the turn's first request to its last measured moment. */
  elapsedMs: number
}

/** How a provider request ended. */
type RequestOutcome = 'pending' | 'ok' | 'error' | 'aborted' | 'unmeasured'

/**
 * One provider request, as far as it could be measured.
 *
 * Every field a request can end before populating is nullable, so a chart drawn from
 * these never mistakes "not known" for a zero.
 */
interface ProviderRequestRecord {
  /** Position in the session, 1-based and never reused. */
  index: number
  /** When the request was handed to the provider, epoch ms. */
  startedAt: number
  /** HTTP status, once the response headers arrived. */
  status: number | null
  /** Request to response headers. On Ollama this is the prefill. */
  prefillMs: number | null
  /** Request to the first content delta. */
  firstTokenMs: number | null
  /** Request to the finished message. */
  totalMs: number | null
  /** Prompt tokens, prefilled and reused together. */
  promptTokens: number | null
  /** Prompt tokens the daemon had to prefill. */
  prefilledTokens: number | null
  /** Prompt tokens the daemon reused. */
  cachedTokens: number | null
  /** Tokens generated, reasoning included. */
  outputTokens: number | null
  /** Of those, the ones spent thinking. 0 on Ollama means "not reported". */
  reasoningTokens: number | null
  /** What happened to the prefix. */
  cache: CacheVerdict
  /** How the request ended. */
  outcome: RequestOutcome
}

/** Counts that outlive the request ring buffer. */
interface TelemetryTotals {
  /** Provider requests started. */
  requests: number
  /** Prompt tokens prefilled across the session. */
  prefilledTokens: number
  /** Prompt tokens reused across the session. */
  cachedTokens: number
  /** Tokens generated across the session. */
  outputTokens: number
  /** Of those, the ones spent thinking. */
  reasoningTokens: number
  /** Wall time spent prefilling. */
  prefillMs: number
  /** Requests whose prefix shrank with no compaction to explain it. */
  invalidations: number
  /** Requests whose prefix shrank because history had been summarized. */
  compactions: number
}

/** A reading of the session's request history. */
interface TelemetrySnapshot {
  /** The recent requests, oldest first. */
  requests: readonly ProviderRequestRecord[]
  /** Lifetime counts. */
  totals: TelemetryTotals
  /** The turn in progress, or the one that just finished. */
  turn: TurnCost
  /** Measured prefill rate in tokens per second, or null before there is a sample. */
  prefillRate: number | null
  /** Measured decode rate in tokens per second, or null before there is a sample. */
  decodeRate: number | null
}

/** Whether the daemon can answer, and whether it still holds the model. */
interface DaemonHealth {
  /** Whether the daemon answered at all. */
  reachable: boolean
  /** Whether the selected model is resident, or null when none is selected. */
  modelLoaded: boolean | null
  /** When the daemon will unload it, epoch ms, or null when it is not resident. */
  expiresAt: number | null
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
interface FileNode {
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
interface FileDiagnostic {
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
interface FileContents {
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

/** Where a skill lives. */
type SkillScope = 'app' | 'workspace'

/** The editable part of a skill. */
interface SkillDraft {
  name: string
  description: string
  content: string
}

/** A skill as loaded from disk. */
interface Skill extends SkillDraft {
  filepath: string
  scope: SkillScope
  enabled: boolean
  manifestTokens: number
  bodyTokens: number
  outdated: boolean
  shadowed: boolean
  loadedThisChat: number
}

/** The two skill libraries available to one app. */
interface SkillLibrary {
  app: Skill[]
  workspace: Skill[]
}

/** The result of a change to a skill library. */
interface SkillLibraryUpdate {
  library: SkillLibrary
  warning?: string
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
  autoTitleChats: boolean
  /** Context window to configure for the selected model, or null to discover it. */
  contextWindow: number | null
  /** Which tools the agent exposes; 'auto' picks from the context window. */
  toolProfile: 'auto' | 'lean' | 'full'
  /** Whether to shape the context sent to the model. */
  trimContext: boolean
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
  /** The window Key Lime Pi actually configures, probed from the daemon when it can be. */
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
  /** Stable identifier correlating this call with its result. */
  toolCallId?: string
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
/** Bounding box of an inspected element, in CSS pixels. */
interface ElementBounds {
  x: number
  y: number
  width: number
  height: number
}

/** DOM details of an element selected in the preview panel. */
interface ElementInfo {
  tag: string
  text: string
  classes: string[]
  id?: string
  selector: string
  xpath: string
  bounds: ElementBounds
}

/** An inspected element plus its screenshot. */
interface ElementContext {
  element: ElementInfo
  /** Screenshot as a base64 data URL. */
  screenshot?: string
  /** ISO timestamp of capture. */
  capturedAt: string
}

/** Serialized UI element context block. */
interface SerializedElementBlock {
  type: 'element'
  elementContext: ElementContext
}

type SerializedContentBlock =
  | SerializedTextBlock
  | SerializedToolBlock
  | SerializedApprovalBlock
  | SerializedElementBlock

/** A persisted chat message. */
interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: SerializedContentBlock[]
  timestamp: string
}

/** A session's transcript, tagged with the session it belongs to. */
interface ChatHistoryPayload {
  sessionId: string | null
  messages: PersistedMessage[]
}

/** A chat session within an app. */
interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  hasExplicitName: boolean
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
  sendMessage: (message: string | SerializedContentBlock[], appId: string): Promise<void> => {
    return ipcRenderer.invoke('agent:message', message, appId)
  },

  /**
   * Listen for streamed agent responses.
   *
   * Returns its own unsubscribe rather than pairing with an `off` that called
   * `removeAllListeners`. That pairing is why every dock panel but Code had to be
   * a singleton: two panels on one channel tore down each other's stream when
   * either unmounted. Removing the exact handler makes the channel shareable.
   *
   * @param callback - Function called with each streamed chunk
   * @returns Unsubscribe
   */
  onAgentStream: (
    appId: string,
    callback: (chunk: StreamChunk) => void
  ): (() => void) => {
    const handler = (_event: unknown, payload: { appId: string | null; chunk: StreamChunk }): void => {
      if (payload.appId !== appId) return
      callback(payload.chunk)
    }
    ipcRenderer.on('agent:stream', handler)
    return () => ipcRenderer.removeListener('agent:stream', handler)
  },

  /**
   * Get the current permission mode.
   */
  getPermissionMode: (appId: string | null): Promise<PermissionMode> => {
    return ipcRenderer.invoke('permissions:get-mode', appId)
  },

  /**
   * Set the permission mode.
   * @param mode - The permission mode to set
   */
  setPermissionMode: (mode: PermissionMode, appId: string | null): Promise<PermissionMode> => {
    return ipcRenderer.invoke('permissions:set-mode', mode, appId)
  },

  /**
   * Listen for tool approval requests.
   * @param callback - Function called when approval is needed
   * @returns Unsubscribe
   */
  onToolApproval: (
    appId: string,
    callback: (request: ToolApprovalRequest) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { appId: string | null; request: ToolApprovalRequest }
    ): void => {
      if (payload.appId !== appId) return
      callback(payload.request)
    }
    ipcRenderer.on('agent:tool-approval', handler)
    return () => ipcRenderer.removeListener('agent:tool-approval', handler)
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
  clearHistory: (appId: string): Promise<void> => {
    return ipcRenderer.invoke('agent:clear-history', appId)
  },

  /**
   * Cancel the in-flight agent run.
   */
  abortAgent: (appId: string): Promise<void> => {
    return ipcRenderer.invoke('agent:abort', appId)
  },

  /**
   * Read what the context window holds, broken down into attributable blocks.
   *
   * Answers without a live agent session — the fixed cost of a request is a pure
   * function of the app and its configuration — so the meter has something honest to
   * show before the first prompt of a session and after every teardown.
   */
  getContextReport: (appId: string): Promise<ContextReport | null> => {
    return ipcRenderer.invoke('agent:get-context-report', appId)
  },

  /**
   * Read what the session's provider requests actually cost.
   *
   * Answers without a live agent session, like the context report and for the same
   * reason: the recorder measures the conversation and outlives the agent host, so a
   * panel can show real numbers the moment it mounts without warming a model.
   */
  getTelemetry: (appId: string): Promise<TelemetrySnapshot> => {
    return ipcRenderer.invoke('agent:get-telemetry', appId)
  },

  /**
   * Summarize the conversation now rather than waiting for the threshold.
   */
  compactContext: (appId: string): Promise<void> => {
    return ipcRenderer.invoke('agent:compact', appId)
  },

  // Version control methods

  /**
   * Get current version control state.
   * @param appId - The app to act on
   */
  getVersionState: (appId: string): Promise<VersionState> => {
    return ipcRenderer.invoke('version:get-state', appId)
  },

  /**
   * Get all branches.
   * @param appId - The app to act on
   */
  getBranches: (appId: string): Promise<Branch[]> => {
    return ipcRenderer.invoke('version:get-branches', appId)
  },

  /**
   * Get commit history.
   * @param depth - Maximum number of commits to return
   * @param appId - The app to act on
   */
  getHistory: (depth: number | undefined, appId: string): Promise<Commit[]> => {
    return ipcRenderer.invoke('version:get-history', depth, appId)
  },

  /**
   * Switch to a branch.
   * @param name - Branch name to switch to
   * @param appId - The app to act on
   */
  switchBranch: (name: string, appId: string): Promise<void> => {
    return ipcRenderer.invoke('version:switch-branch', name, appId)
  },

  /**
   * Create a new branch.
   * @param name - Name for the new branch
   * @param appId - The app to act on
   */
  createBranch: (name: string, appId: string): Promise<Branch> => {
    return ipcRenderer.invoke('version:create-branch', name, appId)
  },

  /**
   * Rollback to a specific commit.
   * @param oid - Commit SHA to rollback to
   * @param appId - The app to act on
   */
  rollback: (oid: string, appId: string): Promise<void> => {
    return ipcRenderer.invoke('version:rollback', oid, appId)
  },

  /**
   * Get diff between two commits.
   * @param from - Source commit SHA
   * @param to - Target commit SHA
   * @param appId - The app to act on
   */
  getDiff: (from: string, to: string, appId: string): Promise<FileDiff[]> => {
    return ipcRenderer.invoke('version:diff', from, to, appId)
  },

  /**
   * The commit a chat session started from.
   *
   * The fixed end of the changed-files strip's diff. Recording is idempotent and
   * first-write-wins in the main process, so asking repeatedly is free and never
   * moves the answer.
   * @param appId - The app the session belongs to
   * @param sessionId - The session to ask about
   * @returns The baseline commit oid, or null when one could not be recorded
   */
  getSessionBaseline: (appId: string, sessionId: string): Promise<string | null> => {
    return ipcRenderer.invoke('changes:session-baseline', appId, sessionId)
  },

  // File reading methods

  /**
   * List the sub-app's source files as a tree.
   *
   * Confined in the main process by the same `isWithinRoot` the agent's permission gate
   * uses, so this can never show a file the agent could not reach.
   *
   * @param appId - The app to act on
   */
  getFileTree: (appId: string): Promise<FileNode[]> => {
    return ipcRenderer.invoke('files:tree', appId)
  },

  /**
   * Read one file from inside the sub-app.
   * @param filePath - Path relative to the app root
   * @param appId - The app to act on
   */
  readFile: (filePath: string, appId: string): Promise<FileContents> => {
    return ipcRenderer.invoke('files:read', filePath, appId)
  },

  /**
   * Compiler errors for one file, from the same language service that checks the
   * agent's writes.
   * @param filePath - Path relative to the app root
   * @param appId - The app to act on
   */
  getFileDiagnostics: (filePath: string, appId: string): Promise<FileDiagnostic[]> => {
    return ipcRenderer.invoke('files:diagnostics', filePath, appId)
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
   * Get both skill libraries for the open app.
   */
  getSkills: (appId: string | null): Promise<SkillLibrary> => {
    return ipcRenderer.invoke('skills:list', appId)
  },

  /**
   * Create or overwrite a skill.
   * @param request - Which library to write to, and the skill's editable fields
   * @returns Both libraries, reloaded, and any warning about the change
   */
  saveSkill: (
    request: { scope: SkillScope; draft: SkillDraft },
    appId: string | null
  ): Promise<SkillLibraryUpdate> => {
    return ipcRenderer.invoke('skills:save', request, appId)
  },

  /**
   * Delete a skill and its directory.
   * @param request - Which library it is in, and its name
   * @returns Both libraries, reloaded, and any warning about the change
   */
  deleteSkill: (
    request: { scope: SkillScope; name: string },
    appId: string | null
  ): Promise<SkillLibraryUpdate> => {
    return ipcRenderer.invoke('skills:delete', request, appId)
  },

  /**
   * Turn a skill on or off for the open app.
   * @param request - The skill's name and whether the app should offer it
   * @returns Both libraries, reloaded
   */
  setSkillEnabled: (
    request: { name: string; enabled: boolean },
    appId: string
  ): Promise<SkillLibrary> => {
    return ipcRenderer.invoke('skills:set-enabled', request, appId)
  },

  /**
   * Listen for the skill libraries changing on disk.
   * @param callback - Function called when a skill may have been added or changed
   * @returns Unsubscribe
   */
  onSkillsChanged: (appId: string | null, callback: () => void): (() => void) => {
    const handler = (_event: unknown, payload?: { appId: string | null }): void => {
      // A null `appId` on either side means "the workspace library", which every
      // subscriber cares about: a workspace skill is offered to every app.
      if (appId !== null && payload?.appId != null && payload.appId !== appId) return
      callback()
    }
    ipcRenderer.on('skills:changed', handler)
    return () => ipcRenderer.removeListener('skills:changed', handler)
  },

  // Workspace layout methods

  /**
   * Read a sub-app's saved dock layout.
   * @param appId - The app whose layout to read
   * @param version - The layout schema version the renderer understands
   * @returns dockview's serialized tree, or null when there is nothing usable
   */
  getWorkspaceLayout: (appId: string, version: number): Promise<unknown | null> => {
    return ipcRenderer.invoke('layout:get', appId, version)
  },

  /**
   * Save a sub-app's dock layout.
   * @param appId - The app whose layout to save
   * @param version - The layout schema version being written
   * @param layout - dockview's serialized tree
   */
  saveWorkspaceLayout: (
    appId: string,
    version: number,
    layout: unknown
  ): Promise<void> => {
    return ipcRenderer.invoke('layout:save', appId, version, layout)
  },

  // Open-app set methods

  /**
   * Read which apps have a rail tile, and which one has focus.
   * @returns The set, already pruned of apps that no longer exist
   */
  getOpenApps: (): Promise<OpenAppsState> => {
    return ipcRenderer.invoke('workspaces:get-open')
  },

  /**
   * Persist which apps have a rail tile, and which one has focus.
   * @param state - The set to remember
   */
  setOpenApps: (state: OpenAppsState): Promise<void> => {
    return ipcRenderer.invoke('workspaces:set-open', state)
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

  /**
   * List the models pulled into the local Ollama daemon.
   * @returns The available models, or an empty array if the daemon is unreachable
   */
  getDaemonHealth: (): Promise<DaemonHealth> => {
    return ipcRenderer.invoke('daemon:health')
  },

  listModels: (): Promise<OllamaModel[]> => {
    return ipcRenderer.invoke('models:list')
  },

  /**
   * Check whether an Ollama daemon is answering.
   * @param baseUrl - Base URL to probe; defaults to the configured one
   * @returns True when the daemon answered
   */
  checkModelConnection: (baseUrl?: string): Promise<boolean> => {
    return ipcRenderer.invoke('models:check-connection', baseUrl)
  },

  // Chat history methods

  /**
   * Load chat history for the active app, tagged with the session it belongs to.
   */
  loadChatHistory: (appId: string): Promise<ChatHistoryPayload> => {
    return ipcRenderer.invoke('chat:load-history', appId)
  },

  /**
   * Clear chat history for the active app.
   */
  clearChatHistory: (appId: string): Promise<void> => {
    return ipcRenderer.invoke('chat:clear-history', appId)
  },

  /**
   * Listen for chat history loaded events.
   * @param callback - Function called with the transcript and the session it is for
   * @returns Unsubscribe
   */
  onChatHistoryLoaded: (
    appId: string,
    callback: (payload: ChatHistoryPayload) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: ChatHistoryPayload & { appId: string | null }
    ): void => {
      if (payload.appId !== appId) return
      callback(payload)
    }
    ipcRenderer.on('chat:history-loaded', handler)
    return () => ipcRenderer.removeListener('chat:history-loaded', handler)
  },

  // Chat session methods

  /**
   * List all chat sessions for the active app.
   */
  listChatSessions: (appId: string): Promise<ChatSession[]> => {
    return ipcRenderer.invoke('sessions:list', appId)
  },

  /**
   * Create a new chat session.
   * @param params - Optional creation parameters
   */
  createChatSession: (params: CreateChatSessionParams | undefined, appId: string): Promise<ChatSession> => {
    return ipcRenderer.invoke('sessions:create', params, appId)
  },

  /**
   * Delete a chat session.
   * @param sessionId - The session ID to delete
   */
  deleteChatSession: (sessionId: string, appId: string): Promise<void> => {
    return ipcRenderer.invoke('sessions:delete', sessionId, appId)
  },

  /**
   * Rename a chat session.
   * @param sessionId - The session ID to rename
   * @param title - The new title
   */
  renameChatSession: (sessionId: string, title: string, appId: string): Promise<ChatSession> => {
    return ipcRenderer.invoke('sessions:rename', sessionId, title, appId)
  },

  /**
   * Set the active chat session.
   * @param sessionId - The session ID to activate
   */
  setActiveChatSession: (sessionId: string, appId: string): Promise<void> => {
    return ipcRenderer.invoke('sessions:set-active', sessionId, appId)
  },

  /**
   * Get the active chat session ID.
   */
  getActiveChatSession: (appId: string): Promise<string | null> => {
    return ipcRenderer.invoke('sessions:get-active', appId)
  },

  /**
   * Listen for session change events.
   * @param callback - Function called when the active session changes
   * @returns Unsubscribe
   */
  onChatSessionChanged: (
    appId: string,
    callback: (sessionId: string | null) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { appId: string | null; sessionId: string | null }
    ): void => {
      if (payload.appId !== appId) return
      callback(payload.sessionId)
    }
    ipcRenderer.on('chat:session-changed', handler)
    return () => ipcRenderer.removeListener('chat:session-changed', handler)
  },

  /**
   * Listen for sessions list updates.
   * @param callback - Function called when the sessions list changes
   * @returns Unsubscribe
   */
  onSessionsListUpdated: (
    appId: string,
    callback: (sessions: ChatSession[]) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { appId: string | null; sessions: ChatSession[] }
    ): void => {
      if (payload.appId !== appId) return
      callback(payload.sessions)
    }
    ipcRenderer.on('sessions:list-updated', handler)
    return () => ipcRenderer.removeListener('sessions:list-updated', handler)
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
   * Record which app the window is showing.
   *
   * Focus only. It no longer decides what any channel acts on — every one of them
   * names its app — and it no longer brings a workspace up either; see
   * {@link openWorkspace}, which each mounted workspace calls for itself.
   *
   * @param id - The app ID now focused, or null to clear
   */
  setActiveApp: (id: string | null): Promise<string | null> => {
    return ipcRenderer.invoke('apps:set-active', id)
  },

  /**
   * Bring a workspace up: resolve its chat session and push its transcript.
   *
   * Called once per mounted workspace, not on focus — several are mounted at once,
   * so the two are different events. Idempotent, so a remount replays the session
   * the manifest already names rather than starting a new conversation.
   *
   * @param appId - The workspace to open
   * @returns Its active chat session, or null when it has none
   */
  openWorkspace: (appId: string): Promise<string | null> => {
    return ipcRenderer.invoke('workspace:open', appId)
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
   * Open an external link in the user's default browser.
   *
   * Used by links in the chat transcript, which are model-authored. The main
   * process rejects anything that is not an absolute `http:`/`https:` URL.
   * @param url - The URL to open
   */
  openExternalUrl: (url: string): Promise<void> => {
    return ipcRenderer.invoke('shell:open-external', url)
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
   * @returns Unsubscribe
   */
  onAppLog: (callback: (entry: AppLogEntry) => void): (() => void) => {
    const handler = (_event: unknown, entry: AppLogEntry): void => callback(entry)
    ipcRenderer.on('apps:log', handler)
    return () => ipcRenderer.removeListener('apps:log', handler)
  },

  /**
   * Listen for app status changes.
   * @param callback - Function called with status changes
   * @returns Unsubscribe
   */
  onAppStatusChange: (callback: (change: AppStatusChange) => void): (() => void) => {
    const handler = (_event: unknown, change: AppStatusChange): void => callback(change)
    ipcRenderer.on('apps:status-change', handler)
    return () => ipcRenderer.removeListener('apps:status-change', handler)
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
  captureElement: (elementInfo: ElementInfo): Promise<ElementContext> => {
    return ipcRenderer.invoke('inspector:capture-element', elementInfo)
  },

  /**
   * Add element context to the current chat.
   */
  addElementContext: (context: ElementContext): Promise<void> => {
    return ipcRenderer.invoke('chat:add-element-context', context)
  },

  /**
   * Listen for element context added events.
   */
  onElementContextAdded: (
    appId: string,
    callback: (context: ElementContext) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { appId: string | null; context: ElementContext }
    ): void => {
      if (payload.appId !== appId) return
      callback(payload.context)
    }
    ipcRenderer.on('chat:element-context-added', handler)
    return () => ipcRenderer.removeListener('chat:element-context-added', handler)
  }
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI
