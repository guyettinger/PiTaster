/**
 * IPC handlers for agent communication between main and renderer processes.
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import { nanoid } from 'nanoid'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import {
  createAgentHost,
  resolveToolNames,
  REASONING_LEVELS,
  DEFAULT_REASONING_LEVEL,
  type ReasoningLevel,
  PI_BUILTIN_TOOL_NAMES,
  type AgentHost
} from './agent/session'
import {
  DEFAULT_SAMPLING_TEMPERATURE,
  DEFAULT_SAMPLING_TOP_P,
  MAX_SAMPLING_TEMPERATURE,
  MAX_SAMPLING_TOP_P,
  MIN_SAMPLING_TEMPERATURE,
  MIN_SAMPLING_TOP_P,
  type SamplingSetting
} from './agent/sampling'
import { buildContextReport } from './agent/context-report'
import { createTelemetry, type Telemetry } from './agent/telemetry'
import { readWorkspaceLayout, writeWorkspaceLayout } from './layout-store'
import { readOpenApps, writeOpenApps } from './open-apps-store'
import { serialized } from './serialize'
import { InferenceCancelled, inferenceQueue } from './inference-queue'
import {
  allRuntimes,
  configureWorkspaces,
  existingRuntime,
  dropAllRuntimes,
  dropRuntime,
  focusedWorkspace,
  getFocusedAppId,
  hostsToEvict,
  setFocusedAppId,
  touchRuntime,
  withWorkspace,
  type Workspace,
  type WorkspaceRuntime
} from './workspaces'
import { ensureSessionBaseline, readSessionBaseline } from './session-baselines'
import { describeNetworkUse } from './agent/permission-gate'
import { previewPatch } from './agent/patch'
import { listAppFiles, readAppFile } from './files'
import { acquireTsService } from './agent/ts-service/registry'
import { autoCommitSkillChange } from './agent/auto-commit'
import { getAppSkillsDir } from './agent/skills'
import {
  VersionManager,
  SourceManager,
  seedSkills,
  SkillsLoader,
  buildSkillLibrary,
  activeSkills,
  extractSkillMentions,
  isValidSkillName,
  AppManager,
  isValidAppId,
  AppRunner,
  ChatHistoryManager,
  installDependencies
} from '@pitaster/shared'
import type { AgentStatus, ContextReport, DaemonHealth, TelemetrySnapshot, PermissionMode, StreamChunk, SkillDraft, SkillLibrary, SkillLibraryUpdate, SkillScope, CreateAppParams, SubApp, AppLogEntry, AppStatusChange, RunningApp, PersistedMessage, ChatHistoryPayload, ChatSession, CreateChatSessionParams, SerializedContentBlock, ElementContext, AnySourceConfig, McpSourceConfig, OpenAppsState } from '@pitaster/core'
import {
  DEFAULT_OLLAMA_BASE_URL,
  isOllamaReachable,
  listOllamaModels,
  readDaemonHealth,
  prepareModelForSession,
  syncOllamaModels,
  type OllamaModel
} from './agent/ollama'
import { summarizeSessionTitle } from './agent/session-title'
import {
  deriveContextBudget,
  MAX_CONTEXT_WINDOW,
  MIN_CONTEXT_WINDOW,
  type ContextBudget
} from './agent/context-budget'
import { captureElement, type ElementInfo } from './screenshot'
import { openExternalUrl } from './external-links'

/** Directory of this module, for resolving bundled assets under ESM. */
const moduleDir = dirname(fileURLToPath(import.meta.url))

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

/**
 * Approval requests waiting on the user.
 *
 * Resolve-only: every way one of these can end — answered, aborted, app switched,
 * window closed — is either an approval or a denial. Rejecting instead would throw
 * inside the `tool_call` handler awaiting it, which is not a decision the permission
 * gate knows how to represent.
 */
const pendingApprovals = new Map<string, {
  /** The workspace whose turn is asking. */
  appId: string
  resolve: (approved: boolean) => void
}>()

/**
 * The budget the live host was built with, kept after that host is gone.
 *
 * Deriving it again means asking Ollama, and `prepareModelForSession` warms the model
 * to do it — tens of seconds, and the longest wait in the app. A context report is not
 * worth paging a 20GB model into memory, so the last real answer is remembered and a
 * conservative default stands in until there has been one.
 */
let lastBudget: ContextBudget | null = null

/**
 * Drop a workspace's remembered conversation.
 *
 * Called only where the conversation itself changes — a cleared chat, a different
 * session. **Not** on a skills, sources or config save: those dispose the host, but
 * the conversation it was holding is still the one on screen, and forgetting it there
 * is what would make the meter look broken. And no longer on an app switch either —
 * with the report living on the runtime, another app's conversation is simply another
 * runtime's, so there is nothing to forget on the way past.
 *
 * @param runtime - The workspace whose report to drop
 */
function forgetCachedReport(runtime: WorkspaceRuntime): void {
  runtime.cachedReport = null
}

/**
 * Start measuring a workspace again, because its conversation changed.
 *
 * Paired with {@link forgetCachedReport} at every site, and always after the host is
 * disposed — a live host holds the recorder it was built with, so replacing it while
 * one is running would leave that host writing to a recorder nobody reads.
 *
 * @param runtime - The workspace whose telemetry to reset
 */
function forgetSessionTelemetry(runtime: WorkspaceRuntime): void {
  runtime.telemetry = createTelemetry()
}

/** Maximum accepted prompt length, in characters. */
const MAX_PROMPT_CHARS = 100000

/** Maximum accepted number of content blocks in one prompt. */
const MAX_PROMPT_BLOCKS = 100

/**
 * Maximum accepted length of a chat session id.
 *
 * Ids are generated in main and are far shorter than this; the bound exists because
 * the renderer is untrusted and hands them back. An id is persisted into the chat
 * pointer and replayed on every later app switch, so an unbounded one is not a bad
 * argument to one call — it is a bad argument to every call that follows.
 */
const MAX_SESSION_ID_LENGTH = 256

/**
 * Reject a session id the renderer should never have sent.
 * @param sessionId - The value received over IPC
 * @throws {Error} If it is not a string of usable length
 */
function assertSessionId(sessionId: unknown): asserts sessionId is string {
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH
  ) {
    throw new Error('Invalid session ID')
  }
}

/** Config directory for sources and skills. */
const configDir = join(homedir(), '.pitaster')

/** Pi agent directory, holding models.json, settings.json and session transcripts. */
const piAgentDir = join(configDir, 'pi')


/** Source manager instance. */
const sourceManager = new SourceManager(configDir)

/** The workspace skills root, shared by every app. */
const workspaceSkillsDir = join(configDir, 'skills')

/** Loader for the workspace skills library. */
const workspaceSkills = new SkillsLoader(workspaceSkillsDir, 'workspace')

/** App manager instance. */
const appManager = new AppManager()

// Wire the workspace registry to the app manager.
//
// Injected rather than imported by `workspaces.ts` so that module stays free of
// this one, which imports it — and so `AppManager.getApp` stays the single guard
// that turns an id into a path. `withWorkspace` deliberately owns no path logic of
// its own; it is a funnel, not a second implementation of the sandbox.
configureWorkspaces({
  lookupApp: (id) => appManager.getApp(id),
  createTelemetry,
  // Eviction must not take a host out from under a question the user is still
  // looking at: the prompt has no timeout, and their answer would resolve into a
  // session that no longer exists.
  hasPendingApprovals: (appId) => {
    for (const pending of pendingApprovals.values()) {
      if (pending.appId === appId) return true
    }
    return false
  }
})

/** App runner instance for dev servers. */
const appRunner = new AppRunner()

/** Chat history manager instance. */
const chatHistoryManager = new ChatHistoryManager(piAgentDir)

/**
 * How many times the agent has loaded each skill, per chat.
 *
 * Counted in main rather than in the renderer because the Skills page and the chat are
 * different main panels: the transcript's stream subscription is torn down when the user
 * navigates to Skills, which is exactly when they want to see this. Main is also simply
 * where the truth is — the tool call passes through here on its way to the transcript.
 *
 */
const skillLoadsByChat = new Map<string, Map<string, number>>()

/**
 * Forget the load counts for chats that no longer exist.
 *
 * The counts are keyed by chat, and a deleted chat's key would otherwise be held for the
 * lifetime of the process. Deleting an app takes its chats with it, so both paths clear.
 *
 * @param sessionIds - The chats being removed
 */
function forgetSkillLoads(sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    skillLoadsByChat.delete(sessionId)
  }
}

/**
 * The load counts for one chat, or an empty map when there is none.
 * @param sessionId - The chat to report on
 */
function skillLoadsFor(sessionId: string | null): Map<string, number> {
  return skillLoadsByChat.get(sessionId ?? '') ?? new Map()
}

/**
 * Record a skill the agent has just loaded.
 *
 * Keyed by chat rather than reset on every switch: the counts are then simply correct
 * when the user comes back to an earlier chat, and there is no list of assignment sites
 * that has to stay in step with a reset call.
 *
 * @param chunk - A streamed chunk on its way to the renderer
 * @param sessionId - The chat the turn belongs to, which is not necessarily the
 *   focused one: a turn can run in a background workspace, and crediting the load
 *   to whatever chat happens to be on screen would report it against the wrong
 *   conversation.
 * @returns True when a count changed and the panel should be told
 */
function recordSkillLoad(chunk: StreamChunk, sessionId: string | null): boolean {
  if (chunk.type !== 'tool_start' || chunk.tool !== 'load_skill') return false

  const name = chunk.input?.name
  if (typeof name !== 'string' || name.length === 0) return false

  const chatId = sessionId ?? ''
  const counts = skillLoadsByChat.get(chatId) ?? new Map<string, number>()
  counts.set(name, (counts.get(name) ?? 0) + 1)
  skillLoadsByChat.set(chatId, counts)
  return true
}

/**
 * Bring the session list up to date after a turn, and name the chat if it has none.
 *
 * Titling runs at most once per session and never over a name someone set: the
 * guard is `hasExplicitName`, and writing a title sets it. Everything here is
 * best-effort — the list already shows a title derived from the first message, so
 * a failed or skipped generation leaves the sidebar correct, just less concise.
 *
 * @param mainWindow - The window to notify
 * @param workspace - The workspace whose turn finished
 */
async function onTurnComplete(
  mainWindow: BrowserWindow,
  workspace: Workspace
): Promise<void> {
  // The workspace whose turn this was, not the focused one. A turn can finish in a
  // background app, and reading focus here would name a chat in a different app —
  // titling the wrong conversation and refreshing the wrong session list.
  const appId = workspace.id
  const sessionId = workspace.runtime.activeSessionId

  // The agent can write a skill into the app's `skills/` directory during a turn, and
  // the panel would otherwise not show it until the user pressed reload. A turn boundary
  // is a cheap and sufficient trigger — a skill library is a handful of small files, and
  // it is the only moment a skill can appear without the renderer already knowing. A
  // filesystem watcher would also catch a hand edit in Finder, which the reload button
  // covers, at the price of two watchers whose lifetime tracks the active app.
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('skills:changed', { appId })
  }

  const sessions = await broadcastSessions(mainWindow, appId)

  const config = getConfig()
  if (!config.autoTitleChats || !config.ollamaModel || !sessionId || !sessions) return

  try {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    // An untitled session whose title is still the placeholder has no first
    // message to summarize yet, so there is nothing to improve on.
    if (!session || session.hasExplicitName || session.messageCount === 0) return

    const firstMessage = await chatHistoryManager.getFirstUserMessage(appId, sessionId)
    if (!firstMessage) return

    const title = await summarizeSessionTitle({
      baseUrl: config.ollamaBaseUrl,
      modelId: config.ollamaModel,
      firstMessage
    })
    if (!title) return

    // The session may have been renamed or deleted while the model was thinking.
    const current = (await chatHistoryManager.listSessions(appId)).find(
      (candidate) => candidate.id === sessionId
    )
    if (!current || current.hasExplicitName) return

    await chatHistoryManager.renameSession(appId, sessionId, title)
    await broadcastSessions(mainWindow, appId)
  } catch {
    // The derived title stands.
  }
}

/**
 * Tell the renderer which session is active and hand it that session's transcript.
 *
 * Order matters and is the whole point of this helper. The renderer clears its
 * messages when the active session changes, so a transcript sent *before* the
 * change is wiped by it — which is what made opening a chat take two clicks: the
 * first click loaded the history and then threw it away, the second changed
 * nothing and let it stand. The payload is tagged as well, so the renderer stays
 * correct even if these ever arrive out of order.
 *
 * @param mainWindow - The window to notify
 * @param sessionId - The session now active, or null when there is none
 * @param messages - That session's transcript
 */
function sendSessionChanged(
  mainWindow: BrowserWindow,
  appId: string | null,
  sessionId: string | null,
  messages: PersistedMessage[]
): void {
  if (mainWindow.isDestroyed()) return
  // Fire and forget, deliberately. The changed-files strip needs the commit this
  // session started from, and the honest moment to record it is here — not when the
  // strip first asks, which never happens at all if the Chat panel is closed while
  // the agent works. Awaiting it would make this function async and put a git read
  // between the two sends below, whose order is the whole point of the helper.
  if (appId && sessionId) void captureSessionBaseline(appId, sessionId)
  // Both carry the app they are about. A renderer with several workspaces mounted
  // has several subscribers on this one channel, and only the one whose app this
  // names may act on it — otherwise a background workspace's session change would
  // rewrite the transcript the user is looking at.
  mainWindow.webContents.send('chat:session-changed', { appId, sessionId })
  mainWindow.webContents.send('chat:history-loaded', { appId, sessionId, messages })
}

/**
 * Record where a chat session's work started, if it has no baseline yet.
 *
 * First-write-wins lives in the store; this is only the part that has to touch git.
 * Every failure is swallowed: an app with no repo, a HEAD that does not resolve, an
 * unwritable store. None of them is worth failing a session switch over — the strip
 * degrades to showing uncommitted work, and the next call tries again.
 * @param appId - The app the session belongs to
 * @param sessionId - The session to record a baseline for
 * @returns The session's baseline commit, or null when one could not be recorded
 */
async function captureSessionBaseline(appId: string, sessionId: string): Promise<string | null> {
  try {
    // `getApp` rather than a join: it routes through `AppManager.appDir`, which is
    // part of the sandbox — an id must be one path segment resolving to a direct
    // child of the apps root. An id becoming a path is always validated here.
    const app = await appManager.getApp(appId)
    if (!app) return null

    const state = await new VersionManager(app.path).getState()
    if (!state.head) return null

    const entries = await fs.readdir(appManager.getAppsDir(), { withFileTypes: true })
    return await ensureSessionBaseline({
      storePath: baselinePath,
      appId,
      sessionId,
      head: state.head,
      liveAppIds: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    })
  } catch {
    return null
  }
}

/**
 * Recompute an app's chat session list and push it to the renderer.
 *
 * The sidebar is a pure subscriber to this event, so every path that changes a
 * session — creating, deleting, renaming, or finishing a turn — has to call it.
 * Without it the list keeps whatever it was given when the app was focused: a new
 * chat never appears, a title derived from the first message never updates, and
 * `updatedAt` never advances, which freezes the sort order at app-open time.
 *
 * Listing is not cheap — Pi reads every transcript in the app end to end to build
 * it — so the list is returned as well as sent, for callers that need to look at
 * it and would otherwise ask for it twice.
 *
 * @param mainWindow - The window to notify
 * @param appId - The sub-app whose sessions changed, or null to do nothing
 * @returns The sessions that were sent, or null when none could be read
 */
async function broadcastSessions(
  mainWindow: BrowserWindow,
  appId: string | null
): Promise<ChatSession[] | null> {
  if (!appId || mainWindow.isDestroyed()) return null
  // Coalesced per app. Listing reads every transcript in the app end to end, and
  // several paths call this within a few milliseconds of each other at the end of
  // a turn — with N workspaces those overlap across apps as well as within one.
  // Keyed by app, so a busy workspace never delays another's sidebar.
  return serialized(`sessions:${appId}`, () => readAndSendSessions(mainWindow, appId))
}

/**
 * The listing itself.
 *
 * @param mainWindow - The window to notify
 * @param appId - The sub-app whose sessions changed
 * @returns The sessions that were sent, or null when none could be read
 */
async function readAndSendSessions(
  mainWindow: BrowserWindow,
  appId: string
): Promise<ChatSession[] | null> {
  if (mainWindow.isDestroyed()) return null
  try {
    const sessions = await chatHistoryManager.listSessions(appId)
    if (mainWindow.isDestroyed()) return null
    mainWindow.webContents.send('sessions:list-updated', { appId, sessions })
    return sessions
  } catch {
    // A list that could not be read is not worth failing the operation that
    // triggered it — the sidebar keeps what it has until the next change.
    return null
  }
}

/** Path to config file. */
const configPath = join(configDir, 'config.json')

/**
 * Path to the workspace layout store.
 *
 * Beside `config.json` rather than inside each app, because an app's directory
 * is a git repo every agent write commits to — see `layout-store.ts`.
 */
const layoutPath = join(configDir, 'layouts.json')

/**
 * Path to the open-app set — which apps have a rail tile, and which has focus.
 *
 * Beside the layouts, and for the same reason: it is shell state, not app state,
 * and an app's own directory is a git repo every agent write commits to.
 */
const openAppsPath = join(configDir, 'open-apps.json')

/**
 * Path to the chat session baseline store.
 *
 * Beside `layouts.json`, and outside the app repo for a sharper version of the same
 * reason: a baseline kept in the app would be rolled back by a rollback of the code,
 * destroying the reference that rollback should be measured against. See
 * `session-baselines.ts`.
 */
const baselinePath = join(configDir, 'session-baselines.json')

/**
 * Legacy path to the encrypted Anthropic API key.
 *
 * Pi Taster runs on a local Ollama daemon and no longer holds any secret, so this file
 * is deleted on startup rather than read.
 */
const legacyApiKeyPath = join(configDir, '.apikey')

/**
 * Persisted application configuration, stored at `~/.pitaster/config.json`.
 */
interface AppConfig {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  ollamaBaseUrl: string
  /** Selected model tag, for example `qwen3-coder:30b`, or null when none is chosen. */
  ollamaModel: string | null
  /** UI colour theme. */
  theme: 'light' | 'dark' | 'system'
  /** Whether agent file writes auto-commit to git. */
  autoCommit: boolean
  /**
   * Whether a new chat is named by the local model after its first turn.
   *
   * Off, the sidebar still names a chat after its first message, truncated. On,
   * that name is replaced once by a short summary. Either way nothing overwrites a
   * name the user typed.
   */
  autoTitleChats: boolean
  /**
   * Context window to configure for the selected model, or null to discover it.
   *
   * Ollama's advertised context length is the model's architectural maximum, not
   * what the daemon serves; Pi Taster probes `/api/ps` for the real number and falls
   * back to a conservative default. This is the escape hatch when both are wrong.
   */
  contextWindow: number | null
  /** Which tools the agent exposes; 'auto' picks from the context window. */
  toolProfile: 'auto' | 'lean' | 'full'
  /** Whether to shape the context sent to the model. */
  trimContext: boolean
  /**
   * Sampling temperature for the model, or null to use the model's own default.
   *
   * Pi exposes no temperature and Ollama takes its default from the model's
   * Modelfile — 0.7 to 1.0 on the qwen builds Pi Taster targets. Most of a coding turn
   * is reproducing text that already exists, so Pi Taster pins 0; null restores the
   * model's default for anyone who wants it.
   */
  samplingTemperature: SamplingSetting
  /**
   * Nucleus cutoff, in the same three states as {@link samplingTemperature}.
   *
   * `top_p` is one of the five parameters Ollama's OpenAI-compatible endpoint actually
   * maps. `top_k`, `min_p` and `repeat_penalty` are Ollama-native options with no place
   * in that schema and are deliberately absent: the audit found them accepted without
   * an error and found no evidence they were honoured.
   */
  samplingTopP: SamplingSetting
  /**
   * How hard to ask the model to think.
   *
   * Only three levels are offered because only three are distinguishable on Ollama,
   * and `unset` is not `off` — see `ReasoningLevel` in `agent/session.ts`.
   */
  reasoningLevel: ReasoningLevel
}

/** Default configuration. */
const defaultConfig: AppConfig = {
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
  ollamaModel: null,
  theme: 'dark',
  autoCommit: true,
  autoTitleChats: true,
  contextWindow: null,
  toolProfile: 'auto',
  trimContext: true,
  samplingTemperature: DEFAULT_SAMPLING_TEMPERATURE,
  samplingTopP: DEFAULT_SAMPLING_TOP_P,
  reasoningLevel: DEFAULT_REASONING_LEVEL
}

/** Cached configuration, populated by {@link loadConfig}. */
let cachedConfig: AppConfig = { ...defaultConfig }

/**
 * Get the most recently loaded configuration without touching disk.
 * @returns The cached configuration
 */
export function getConfig(): AppConfig {
  return cachedConfig
}

/**
 * Get the Pi agent directory.
 * @returns Absolute path to `~/.pitaster/pi`
 */
export function getPiAgentDir(): string {
  return piAgentDir
}

/**
 * Load the application configuration from disk and cache it.
 * @returns The loaded configuration, or defaults when it cannot be read
 */
async function loadConfig(): Promise<AppConfig> {
  try {
    await fs.mkdir(configDir, { recursive: true })

    let config = { ...defaultConfig }
    try {
      const data = await fs.readFile(configPath, 'utf-8')
      config = { ...defaultConfig, ...JSON.parse(data) }
    } catch {
      // Config doesn't exist yet, use defaults
    }

    // Remove the ciphertext left behind by earlier Anthropic-backed versions.
    await fs.rm(legacyApiKeyPath, { force: true })

    cachedConfig = config
    return config
  } catch (error) {
    console.error('Failed to load config:', error)
    cachedConfig = { ...defaultConfig }
    return cachedConfig
  }
}

/**
 * Save the application configuration and re-sync Pi's model catalog.
 * @param config - The configuration to persist
 */
async function saveConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  cachedConfig = config

  // Keep Pi's models.json in step with the configured daemon.
  await syncOllamaModels({
    agentDir: piAgentDir,
    baseUrl: config.ollamaBaseUrl,
    selectedModel: config.ollamaModel,
    contextWindowOverride: config.contextWindow
  })
}

/**
 * Load configuration at startup and write Pi's model catalog.
 *
 * Earlier versions only reached {@link loadConfig} from the `config:get` handler, so a
 * fresh launch never saw the persisted settings.
 */
export async function initializeConfig(): Promise<void> {
  const config = await loadConfig()
  await syncOllamaModels({
    agentDir: piAgentDir,
    baseUrl: config.ollamaBaseUrl,
    selectedModel: config.ollamaModel,
    contextWindowOverride: config.contextWindow
  })
}

/** Longest accepted skill description. One line, and it rides in every request. */
const MAX_SKILL_DESCRIPTION_CHARS = 500

/** Longest accepted skill body. */
const MAX_SKILL_CONTENT_CHARS = 100000

/**
 * Load both skill libraries for the open app.
 *
 * With no app open only the workspace library is populated — that is not an error, it
 * is what the Skills page shows before an app is picked.
 *
 * @returns The app and workspace libraries, resolved against each other
 */
async function loadSkillLibrary(workspace: Workspace | null): Promise<SkillLibrary> {
  const app = workspace?.app ?? null

  const library = await buildSkillLibrary({
    appSkillsDir: app ? getAppSkillsDir(app.path) : null,
    workspaceSkillsDir,
    disabledSkills: app?.disabledSkills
  })

  const loads = skillLoadsFor(workspace?.runtime.activeSessionId ?? null)
  for (const skill of [...library.app, ...library.workspace]) {
    skill.loadedThisChat = loads.get(skill.name) ?? 0
  }

  return library
}

/**
 * Resolve a scope to the loader that owns it.
 *
 * The app root is read from the active app here rather than accepted from the renderer.
 * The renderer is untrusted, and a path argument would let it name any directory on the
 * machine as a skills root — which is a write primitive, since `save` creates what it
 * needs.
 *
 * @param scope - Which library to act on
 * @returns A loader bound to that library's directory
 * @throws {Error} If the app library is asked for with no app open
 */
function loaderForScope(scope: SkillScope, workspace: Workspace | null): SkillsLoader {
  if (scope === 'workspace') return workspaceSkills

  if (!workspace) {
    throw new Error("Open an app before changing that app's skills")
  }
  // Still built from the *resolved* app root, never from anything the renderer
  // spelled — `withWorkspace` is what turned an id into this path, and a path
  // argument here would be a write primitive, since `save` creates what it needs.
  return new SkillsLoader(getAppSkillsDir(workspace.root), 'app')
}

/**
 * Validate a `{ scope, name }` request from the renderer.
 * @param request - The raw IPC argument
 * @returns The validated scope and skill name
 * @throws {Error} If either field is missing or malformed
 */
function parseSkillRef(request: unknown): { scope: SkillScope; name: string } {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Invalid request')
  }
  const { scope, name } = request as { scope?: unknown; name?: unknown }
  if (scope !== 'app' && scope !== 'workspace') {
    throw new Error('Invalid skill scope')
  }
  if (!isValidSkillName(name)) {
    throw new Error('Invalid skill name. Use lowercase letters, numbers and hyphens.')
  }
  return { scope, name }
}

/**
 * Validate a `{ scope, draft }` write request from the renderer.
 *
 * The description is rejected outright if it spans more than one line rather than being
 * silently joined: the frontmatter parser reads to the end of the first line, so a
 * wrapped description loses its tail, and the tail is the part carrying the trigger
 * words. Failing here is what makes that visible.
 *
 * @param request - The raw IPC argument
 * @returns The validated scope and skill draft
 * @throws {Error} If any field is missing, malformed, or too long
 */
function parseSkillWrite(request: unknown): { scope: SkillScope; draft: SkillDraft } {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Invalid request')
  }
  const { scope, draft } = request as { scope?: unknown; draft?: unknown }
  if (scope !== 'app' && scope !== 'workspace') {
    throw new Error('Invalid skill scope')
  }
  if (typeof draft !== 'object' || draft === null) {
    throw new Error('Invalid skill')
  }

  const { name, description, content } = draft as {
    name?: unknown
    description?: unknown
    content?: unknown
  }

  if (!isValidSkillName(name)) {
    throw new Error('Invalid skill name. Use lowercase letters, numbers and hyphens.')
  }
  if (
    typeof description !== 'string' ||
    description.length === 0 ||
    description.length > MAX_SKILL_DESCRIPTION_CHARS
  ) {
    throw new Error(`A description is required, up to ${MAX_SKILL_DESCRIPTION_CHARS} characters`)
  }
  if (/[\r\n]/.test(description)) {
    throw new Error('A description must be a single line')
  }
  if (typeof content !== 'string' || content.length > MAX_SKILL_CONTENT_CHARS) {
    throw new Error(`A skill body may be up to ${MAX_SKILL_CONTENT_CHARS} characters`)
  }

  return { scope, draft: { name, description, content } }
}

/**
 * Commit an app skill the user just wrote or deleted.
 *
 * The panel marks app skills **Versioned**, and they only are if a panel edit reaches
 * git — the agent's writes get there through the `tool_result` hook, and a panel edit
 * passes through no tool. Workspace skills are not in any repository, so nothing is
 * committed for them.
 *
 * Best-effort: a repository that is not initialised, or a commit that fails, must not
 * cost the user the skill they just wrote.
 *
 * A failure is returned rather than swallowed: the write itself succeeded, so throwing
 * would misreport it, but `.claude/rules/self-modification.md` is explicit that a git
 * failure must still be reported. The panel shows it beside the skill.
 *
 * @param scope - Which library was changed
 * @param name - The skill's name
 * @param action - Whether the skill was written or deleted
 * @returns A warning when the change landed on disk but not in git
 */
async function commitAppSkill(
  scope: SkillScope,
  name: string,
  action: 'write' | 'delete',
  workspace: Workspace | null
): Promise<string | undefined> {
  if (scope !== 'app') return undefined
  if (!workspace) return undefined

  const relativePath = `skills/${name}/SKILL.md`
  const outcome = await autoCommitSkillChange({
    rootPath: workspace.root,
    relativePath,
    action,
    enabled: getConfig().autoCommit
  })

  if (outcome.committed || !outcome.note) return undefined
  return `Saved, but not committed: ${relativePath} is not versioned with the app.${outcome.note}`
}

/**
 * Turn `@skill-name` mentions into an instruction the model can act on.
 *
 * The mention used to be decoration. The Skills panel typed `@name ` into the composer,
 * the composer's empty state advertised it, and nothing in the main process ever read
 * it — the whole mechanism was a string that happened to appear in a message, and a
 * mistyped name failed the same way a correct one did.
 *
 * The user's own text is left exactly as written and the directive is appended, so the
 * transcript still shows what they typed. Only names that resolve to a skill this
 * session actually offers are honoured, which is what keeps an ordinary `@someone` in
 * prose from becoming an instruction.
 *
 * @param text - The user's message
 * @returns The message, with a directive appended when it named a real skill
 */
async function withSkillDirectives(text: string, workspace: Workspace): Promise<string> {
  const mentions = extractSkillMentions(text)
  if (mentions.length === 0) return text

  const available = activeSkills(await loadSkillLibrary(workspace))
  const named = [...new Set(mentions.map((mention) => mention.name))].filter((name) =>
    available.some((skill) => skill.name === name)
  )
  if (named.length === 0) return text

  const list = named.map((name) => `\`${name}\``).join(', ')
  return `${text}

The user named ${named.length === 1 ? 'a skill' : 'skills'}: ${list}. Call \`load_skill\` for ${named.length === 1 ? 'it' : 'each of them'} before starting, and follow what ${named.length === 1 ? 'it says' : 'they say'}.`
}

/**
 * Install the seed skills, so a fresh machine's agent is not skill-less.
 *
 * `~/.pitaster/skills` was read by the agent and by the Skills panel and written by
 * neither, so on any install where the `docs/skills/` copies had not been placed by hand
 * the agent ran with none. `working-notes` is the one that matters: the post-compaction
 * nudge in `agent/session.ts` tells the model to read `NOTES.md`, and that skill is
 * where the convention for keeping one is defined.
 *
 * A skill the user has edited is never overwritten, but one Pi Taster shipped with content
 * that was untrue of this agent is corrected in place — see {@link seedSkills}.
 */
export async function initializeSkills(): Promise<void> {
  const result = await seedSkills(workspaceSkillsDir)

  // Worth a line in the log: correcting or removing a skill changes what the agent is
  // told it can do, and it happens once, silently, on an upgrade.
  if (result.corrected.length > 0 || result.removed.length > 0) {
    console.log(
      '[skills] corrected:',
      result.corrected.join(', ') || 'none',
      '| removed:',
      result.removed.join(', ') || 'none'
    )
  }
}

/**
 * Connect every enabled source so its tools are available to the agent.
 *
 * Without this a source only ever went live when the user pressed Connect, and the
 * `enabled` flag on a saved config was read by nothing. Failures are per-source and
 * non-fatal: `SourceManager.connect` records the error on the returned
 * `ConnectedSource` rather than throwing, and the panel surfaces it.
 */
export async function initializeSources(): Promise<void> {
  let configs: AnySourceConfig[] = []
  try {
    configs = await sourceManager.loadSources()
  } catch {
    // A missing or malformed sources directory must not block startup.
    return
  }

  await Promise.all(
    configs
      .filter((config) => config.enabled !== false)
      .map((config) => sourceManager.connect(config).catch(() => undefined))
  )
}

/** Maximum length accepted for a source id, name, command, or single argument. */
const MAX_SOURCE_FIELD_CHARS = 500

/** Maximum number of command arguments accepted for a source. */
const MAX_SOURCE_ARGS = 64

/** Maximum number of environment variables accepted for a source. */
const MAX_SOURCE_ENV_VARS = 64

/**
 * Require a non-empty, length-capped string.
 * @param value - The value the renderer sent
 * @param field - Field name, for the error message
 * @returns The trimmed string
 * @throws {Error} If the value is not a usable string
 */
function requireSourceString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Source ${field} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_SOURCE_FIELD_CHARS) {
    throw new Error(`Source ${field} must be 1-${MAX_SOURCE_FIELD_CHARS} characters`)
  }
  return trimmed
}

/**
 * Validate an MCP source configuration arriving from the renderer.
 *
 * The renderer is untrusted, and this payload is unusually load-bearing: it names a
 * command Pi Taster will spawn and, once connected, becomes part of the agent's tool
 * surface. Everything is checked here rather than in `SourceManager`.
 *
 * @param config - The raw value from the renderer
 * @returns A validated MCP source configuration
 * @throws {Error} If any field is missing, mistyped, or out of bounds
 */
/**
 * Whether a string parses as an `http(s)` URL.
 *
 * @param value - The candidate URL
 * @returns True when it parses and uses an http scheme
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Whether a sampling setting is one the daemon will accept.
 *
 * The renderer is untrusted and this value ends up in a provider request body, so the
 * check is on the shape as well as the range: anything that is not a finite number in
 * bounds, `null`, or the literal `'auto'` is refused rather than coerced.
 *
 * @param value - The configured value
 * @param min - Lowest number the endpoint accepts
 * @param max - Highest number the endpoint accepts
 * @returns True when the value may be persisted
 */
function isValidSampling(value: unknown, min: number, max: number): value is SamplingSetting {
  if (value === null || value === 'auto') return true
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validateMcpSourceConfig(config: unknown): McpSourceConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Invalid source configuration')
  }

  const raw = config as Record<string, unknown>

  if (raw.type !== 'mcp') {
    throw new Error('Only MCP sources can be saved')
  }

  const id = requireSourceString(raw.id, 'id')
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error('Source id must contain only lowercase letters, digits, and hyphens')
  }

  if (!Array.isArray(raw.args) || raw.args.length > MAX_SOURCE_ARGS) {
    throw new Error(`Source args must be an array of at most ${MAX_SOURCE_ARGS} strings`)
  }
  const args = raw.args.map((arg, index) => requireSourceString(arg, `argument ${index + 1}`))

  let env: Record<string, string> | undefined
  if (raw.env !== undefined) {
    if (typeof raw.env !== 'object' || raw.env === null || Array.isArray(raw.env)) {
      throw new Error('Source env must be an object')
    }
    const entries = Object.entries(raw.env as Record<string, unknown>)
    if (entries.length > MAX_SOURCE_ENV_VARS) {
      throw new Error(`Source env may hold at most ${MAX_SOURCE_ENV_VARS} variables`)
    }
    env = {}
    for (const [key, value] of entries) {
      env[requireSourceString(key, 'env key')] = requireSourceString(value, `env value for ${key}`)
    }
  }

  return {
    id,
    name: requireSourceString(raw.name, 'name'),
    type: 'mcp',
    enabled: raw.enabled !== false,
    createdAt:
      raw.createdAt === undefined
        ? new Date().toISOString()
        : requireSourceString(raw.createdAt, 'createdAt'),
    command: requireSourceString(raw.command, 'command'),
    args,
    ...(env ? { env } : {})
  }
}

/**
 * Get the currently active app ID.
 */
export function getActiveAppId(): string | null {
  return getFocusedAppId()
}

/**
 * Get the currently active app.
 */
export async function getActiveApp(): Promise<SubApp | null> {
  return (await focusedWorkspace())?.app ?? null
}

/**
 * Resolve an app id that is allowed to be absent.
 *
 * For the skills channels, where `null` genuinely means "no app": the workspace
 * library is editable from Settings with nothing open. Everything else that takes
 * an id requires one.
 *
 * @param appId - The value the renderer sent
 * @returns The workspace, or null when no app was named
 */
async function optionalWorkspace(appId: unknown): Promise<Workspace | null> {
  if (appId === null || appId === undefined) return null
  return withWorkspace(appId, (workspace) => workspace)
}



/**
 * Split a renderer prompt into plain text and attached element contexts.
 *
 * `tool` and `approval` blocks are display-only records of an earlier turn; Pi keeps
 * that history itself, so they are not resent.
 *
 * @param prompt - The prompt as the renderer sent it
 * @returns The message text and any attached element contexts
 */
function splitPrompt(prompt: string | SerializedContentBlock[]): {
  /** The user's message text. */
  text: string
  /** Element contexts attached to the message. */
  elements: ElementContext[]
} {
  if (typeof prompt === 'string') {
    return { text: prompt, elements: [] }
  }

  const textParts: string[] = []
  const elements: ElementContext[] = []

  for (const block of prompt) {
    if (block.type === 'text') {
      textParts.push(block.content)
    } else if (block.type === 'element') {
      elements.push(block.elementContext)
    }
  }

  return { text: textParts.join('\n'), elements }
}

/**
 * Deny every approval prompt still waiting for an answer.
 *
 * Approval prompts have no timeout, so something has to settle the ones the user
 * never answers. Pi cannot: it passes the run's `AbortSignal` as a second argument to
 * `beforeToolCall`, but `AgentSession` destructures only the first and drops it, and
 * `ToolCallEvent` carries no signal either — so aborting a run leaves a pending
 * `tool_call` handler awaiting forever. Every path that ends a run therefore calls
 * this.
 *
 * Denying is the only safe resolution: the user pressed Stop, switched app, or closed
 * the window, and in none of those cases did they approve anything.
 */
function denyPendingApprovals(appId?: string): void {
  for (const [id, pending] of pendingApprovals) {
    // Scoped, because unscoped is now a bug rather than a simplification. Stop in
    // one app used to deny *every* pending prompt, so with two workspaces live it
    // would answer a write prompt another app is still waiting on — a denial the
    // user never made. The prompt is deliberately given no timeout precisely
    // because a silent denial cannot be told apart from a refusal.
    if (appId !== undefined && pending.appId !== appId) continue
    pendingApprovals.delete(id)
    pending.resolve(false)
  }
}

/**
 * Tear down the live agent session, if any.
 */
async function disposeAgentHost(runtime: WorkspaceRuntime | null): Promise<void> {
  if (!runtime?.host) return
  const host = runtime.host
  runtime.host = null
  runtime.hostStale = false
  try {
    await host.abort()
  } catch {
    // Aborting an idle session is not an error.
  }
  host.dispose()
  denyPendingApprovals(runtime.appId)
}

/**
 * Tear down every workspace's agent session.
 *
 * A settings, skills or sources save changes what *every* session was built with,
 * not only the focused one — every host reads those once, when it is built. With
 * one host that distinction did not exist; with a registry it has to be made.
 *
 * A workspace mid-turn is **marked, not disposed**. Killing a background turn
 * because someone saved a setting is a new failure mode and a worse one than a
 * turn finishing under the configuration it started with: the user sees a run
 * they did not stop end with no explanation, in an app they were not looking at.
 * The flag is honoured when that turn ends, in `agent:message`'s `finally`.
 */
async function disposeAllAgentHosts(options?: {
  /**
   * Dispose a workspace mid-turn as well.
   *
   * Only teardown passes this. The deferral above is right for a settings save
   * and wrong for a closing window: there is no later moment to honour the flag
   * in, and a spared host would go on generating into a window that has gone.
   */
  force?: boolean
}): Promise<void> {
  for (const runtime of allRuntimes()) {
    if (runtime.runActive && !options?.force) {
      if (runtime.host) runtime.hostStale = true
      continue
    }
    await disposeAgentHost(runtime)
  }
}

/**
 * Drop the least recently used hosts until the live population is under its cap.
 *
 * The policy is `hostsToEvict`; this is only the part that has to know how a host
 * is torn down. Awaited rather than fired off, so the utilityProcess and the Pi
 * session of the workspace being replaced are gone before the next one is built —
 * the cap exists to bound memory, and a cap enforced asynchronously bounds nothing
 * at the moment it matters.
 *
 * @param protectAppId - The workspace about to become live, which is never evicted
 */
async function evictIdleHosts(protectAppId: string | null): Promise<void> {
  for (const runtime of hostsToEvict(protectAppId)) {
    await disposeAgentHost(runtime)
    // The conversation is not forgotten, only its host: `cachedReport` and
    // `activeSessionId` stay, so the meter reports `stale` rather than dropping
    // to its floor, and the next prompt rebuilds the session it names.
  }
}

/**
 * Refuse an operation that would move the ground under a running turn.
 *
 * `agent:compact` already refused this way, for the reason that generalizes:
 * summarizing a conversation Pi is still appending to summarizes a moving
 * target. A rollback, a branch switch and a dependency install are the same
 * shape against the working tree instead of the transcript — the agent reads a
 * file, the tree changes under it, and the edit it writes back lands on content
 * that no longer exists. Auto-commit then commits that.
 *
 * Refusing is the whole mechanism, deliberately, rather than a lock that queues:
 * these are things a person asked for *now*, and one that silently waits several
 * minutes for a turn to finish is indistinguishable from one that did nothing.
 *
 * @param runtime - The workspace the operation targets
 * @param what - What is being refused, for the message
 * @throws {Error} If a turn is in flight in that workspace
 */
function refuseWhileRunning(runtime: WorkspaceRuntime, what: string): void {
  if (runtime.runActive) {
    throw new Error(`Wait for the current turn to finish before ${what}.`)
  }
}

/**
 * Get a workspace's agent session, creating it on first use.
 *
 * Takes the workspace rather than reading the focused one, so a turn runs against
 * the app that asked for it — which is the whole point of naming an app on
 * `agent:message`. A background workspace can hold a live host of its own.
 *
 * @param mainWindow - The window that receives streamed chunks and approval prompts
 * @param workspace - The workspace to build the session for
 * @returns A live agent host bound to that workspace
 * @throws {Error} If no model is configured
 */
async function ensureAgentHost(
  mainWindow: BrowserWindow,
  workspace: Workspace
): Promise<AgentHost> {
  const { app, runtime } = workspace

  const config = getConfig()
  if (!config.ollamaModel) {
    throw new Error('No model selected. Pick an Ollama model in Settings.')
  }

  // No `host.appId === app.id` check any more: a runtime's host is its own by
  // construction, so the mismatch that check guarded against is unrepresentable.
  if (runtime.host) {
    touchRuntime(runtime)
    return runtime.host
  }

  await disposeAgentHost(runtime)
  await evictIdleHosts(app.id)
  touchRuntime(runtime)

  // Load the model and rewrite models.json with the window it really got, before
  // Pi's ModelRuntime reads that file.
  //
  // This is the longest wait in the app — tens of seconds for a large local model —
  // and it happens before the session exists, so the session's own stall notice
  // cannot cover it. Report it here, or the first prompt of every session looks like
  // a hang.
  const sendStatus = (status: AgentStatus | null): void => {
    if (mainWindow.isDestroyed()) return
    const chunk: StreamChunk = {
      type: 'status',
      status: status ?? { kind: 'settled' }
    }
    mainWindow.webContents.send('agent:stream', { appId: app.id, chunk })
  }

  sendStatus({
    kind: 'waiting',
    detail: `Loading ${config.ollamaModel} into memory — this takes a while the first time.`
  })

  let budget: ContextBudget
  try {
    budget = await prepareModelForSession({
      agentDir: piAgentDir,
      baseUrl: config.ollamaBaseUrl,
      selectedModel: config.ollamaModel,
      contextWindowOverride: config.contextWindow
    })
  } finally {
    sendStatus(null)
  }
  lastBudget = budget

  // Sessions are materialized on creation, so there is always a transcript to
  // resume. Create one only if the app has never had a session at all.
  let sessionFile = await chatHistoryManager.getActiveSessionPath(app.id)
  if (!sessionFile) {
    const created = await chatHistoryManager.createSession(app.id)
    runtime.activeSessionId = created.id
    sessionFile = await chatHistoryManager.getActiveSessionPath(app.id)
  }

  runtime.host = await createAgentHost({
    app,
    agentDir: piAgentDir,
    modelId: config.ollamaModel,
    budget,
    toolProfile: config.toolProfile,
    trimContext: config.trimContext,
    samplingTemperature: config.samplingTemperature,
    samplingTopP: config.samplingTopP,
    reasoningLevel: config.reasoningLevel,
    sessionFile: sessionFile ?? undefined,
    mcpSources: sourceManager.getConnectedSources().filter((source) => source.connected),
    telemetry: runtime.telemetry,
    callbacks: {
      // This workspace's mode, not the process's: a mode change in another app
      // must not widen what this app's in-flight turn may do.
      getPermissionMode: () => runtime.permissionMode,
      // Bound to this workspace. Pi calls this when its retry budget is exhausted,
      // and an unbound call would deny another app's pending prompt along with
      // this one's.
      denyPendingApprovals: () => denyPendingApprovals(app.id),
      getAutoCommit: () => getConfig().autoCommit,

      callMcpTool: (sourceId, toolName, args) =>
        sourceManager.callTool(sourceId, toolName, args),

      requestApproval: async (tool: string, input: unknown): Promise<boolean> => {
        const id = nanoid()
        const args = input as Record<string, unknown>

        // What this write would do, so the prompt shows the change rather than only its
        // path. Accurate or absent — `previewPatch` returns nothing rather than guess.
        const patches = await previewPatch({ rootPath: app.path, toolName: tool, input: args })

        // Surface network use in the prompt. This annotates, it does not gate:
        // `bash` reaches the user for approval either way, and the note only
        // tells them why this particular command is worth reading closely.
        const command = args.command
        const notice =
          (tool === 'bash' || tool === 'powershell') && typeof command === 'string'
            ? describeNetworkUse(command)
            : null

        const request: ToolApprovalRequest = {
          id,
          tool,
          input: args,
          ...(patches.length > 0 ? { patches } : {}),
          ...(notice ? { notice } : {})
        }

        if (mainWindow.isDestroyed()) return Promise.resolve(false)
        // Tagged with the workspace whose turn is asking. With several mounted,
        // an untagged prompt would appear in whichever Chat happened to be
        // listening — and approving a write you cannot see the context for is
        // exactly what the prompt exists to prevent.
        mainWindow.webContents.send('agent:tool-approval', { appId: app.id, request })

        // Deliberately unbounded. A turn on a local model can take minutes, so
        // stepping away while one runs is normal — and a timeout here does not fail
        // safe, it silently *denies* a call the user meant to allow, with no way to
        // tell that apart from a refusal. The prompt is settled by an answer, by
        // aborting the run, or by the session being torn down.
        return new Promise((resolve) => {
          pendingApprovals.set(id, { appId: app.id, resolve })
        })
      },

      onStream: (chunk: StreamChunk): void => {
        if (mainWindow.isDestroyed()) return
        mainWindow.webContents.send('agent:stream', { appId: app.id, chunk })

        if (recordSkillLoad(chunk, runtime.activeSessionId)) {
          mainWindow.webContents.send('skills:changed', { appId: app.id })
        }

        // A finished turn is the only moment the session list is known to have
        // changed — a new message moves `updatedAt`, and the first one gives an
        // untitled chat a name. Deliberately after the turn, never during it: a
        // concurrent generate contends with the model the turn just loaded.
        if (chunk.type === 'complete') {
          void onTurnComplete(mainWindow, workspace)
        }
      }
    }
  })

  return runtime.host
}

/**
 * Set up all IPC handlers for the main window.
 * @param mainWindow - The main BrowserWindow instance
 */
export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // Get current permission mode
  ipcMain.handle('permissions:get-mode', async (_, appId: unknown): Promise<PermissionMode> => {
    // No app named means the Settings page with none open. There is no workspace to
    // report on, and the prompting default is the honest answer rather than another
    // app's mode.
    if (appId === null || appId === undefined) return 'default'
    return withWorkspace(appId, ({ runtime }) => runtime.permissionMode)
  })

  // Set permission mode
  ipcMain.handle(
    'permissions:set-mode',
    async (_, mode: unknown, appId: unknown): Promise<PermissionMode> => {
      if (
        typeof mode !== 'string' ||
        !['plan', 'default', 'acceptEdits', 'bypassPermissions'].includes(mode)
      ) {
        throw new Error(`Invalid permission mode: ${String(mode)}`)
      }
      const next = mode as PermissionMode
      // With no app named there is nothing to set the mode *on*. Answering rather
      // than throwing keeps Settings usable with no app open; it simply has no
      // workspace to apply to yet.
      if (appId === null || appId === undefined) return next
      return withWorkspace(appId, ({ runtime }) => {
        runtime.permissionMode = next
        return runtime.permissionMode
      })
    }
  )

  // Start a fresh agent session, discarding the current transcript
  ipcMain.handle('agent:clear-history', async (_, appId: unknown): Promise<void> => {
    const runtime = await withWorkspace(appId, (workspace) => workspace.runtime)
    await disposeAgentHost(runtime)
    forgetCachedReport(runtime)
    forgetSessionTelemetry(runtime)
  })

  // Send message to agent
  ipcMain.handle('agent:message', async (_, prompt: string | SerializedContentBlock[], appId: unknown): Promise<void> => {
    // Validate input. The renderer is untrusted.
    if (typeof prompt === 'string') {
      if (prompt.length === 0) {
        throw new Error('Invalid prompt')
      }
      if (prompt.length > MAX_PROMPT_CHARS) {
        throw new Error('Prompt too long')
      }
    } else if (Array.isArray(prompt)) {
      if (prompt.length === 0) {
        throw new Error('Invalid prompt: empty blocks array')
      }
      if (prompt.length > MAX_PROMPT_BLOCKS) {
        throw new Error('Invalid prompt: too many blocks')
      }
      for (const block of prompt) {
        if (!block || typeof block !== 'object' || typeof block.type !== 'string') {
          throw new Error('Invalid prompt: block missing type')
        }
      }
    } else {
      throw new Error('Invalid prompt: must be string or content blocks')
    }

    // Resolved before `onStream` is written, not after: a failure in here has to
    // be delivered to a workspace, and a stream helper closing over a binding
    // that is still in its temporal dead zone would throw a second error on the
    // path that reports the first.
    const workspace = await withWorkspace(appId, (resolved) => resolved)

    /**
     * Report progress or failure to the workspace that asked for the turn.
     *
     * Tagged with that workspace rather than the focused one — with several
     * mounted, an untagged chunk surfaces in whichever Chat happens to be
     * listening, which for a background turn is the wrong one by definition.
     */
    const onStream = (chunk: StreamChunk): void => {
      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send('agent:stream', { appId: workspace.id, chunk })
    }

    // Take a place in the queue before anything expensive, and hold it across the
    // model load as well as generation: warming is the daemon's single loaded
    // model too, so two workspaces racing to warm is the same contention with a
    // longer wait.
    //
    // Waiting *here* rather than inside `sendPrompt` is what keeps the queue out
    // of the measurements. Pi's session never sees it, so the stall notifier does
    // not apologise for a queue, `retry-budget` cannot cut a turn that never
    // started, and telemetry does not book the wait as prefill — which would
    // decay the `prefillRate` behind "~1 min to prefill if the cache misses" for
    // every workspace, not only the one that waited.
    const ticket = inferenceQueue.acquire(workspace.id)
    if (ticket.waitingBehind !== null) {
      const ahead = await withWorkspace(ticket.waitingBehind, (other) => other.app.name).catch(
        () => ticket.waitingBehind
      )
      onStream({
        type: 'status',
        status: {
          kind: 'queued',
          detail: `Waiting for ${ahead}’s turn — one local model, one turn at a time.`
        }
      })
    }

    // Flagged on the runtime the host belongs to, so `agent:compact` refuses while
    // *this* workspace is mid-turn rather than while any of them is.
    //
    // Set here rather than around `sendPrompt`, which is where it used to be, and
    // the difference is a window minutes long on a cold model: queueing behind
    // another app and loading a 32GB model both happen before the first token,
    // with Stop showing the whole time. During that window `runActive` was false,
    // so a rollback was accepted and the turn then started against a working tree
    // that had moved. It means "a turn is in flight", and it is in flight from
    // the moment the user pressed Send.
    const { runtime } = workspace
    runtime.runActive = true

    try {
      await ticket.wait()
      onStream({ type: 'status', status: { kind: 'settled' } })

      const host = await ensureAgentHost(mainWindow, workspace)
      const { text, elements } = splitPrompt(prompt)

      if (text.length > MAX_PROMPT_CHARS) {
        throw new Error('Prompt too long')
      }

      await host.sendPrompt({ text: await withSkillDirectives(text, workspace), elements })
    } catch (error) {
      // Stop pressed while the turn was still queued. Nothing ran and nothing
      // failed, so the turn ends quietly — reporting an error here would put a
      // failure in the transcript for something the user did on purpose.
      if (!(error instanceof InferenceCancelled)) {
        const err = error as Error
        onStream({ type: 'error', error: err.message })
      }
      onStream({ type: 'complete' })
    } finally {
      runtime.runActive = false
      touchRuntime(runtime)
      ticket.release()
      // A settings, skills or sources save while this turn ran left the host
      // built against configuration that no longer exists. Cleared after
      // `runActive`, or the deferral this honours would re-arm on the way out.
      if (runtime.hostStale) await disposeAgentHost(runtime)
    }
  })

  // Cancel the in-flight agent run
  ipcMain.handle('agent:abort', async (_, appId: unknown): Promise<void> => {
    // Order matters: deny first, so the `tool_call` handler awaiting approval
    // unblocks and Pi's loop can observe the abort. Aborting alone would not reach
    // it — see denyPendingApprovals.
    // Denies only this workspace's prompts. Stop in one app must not silently
    // answer a write prompt another app is still waiting on — a denial the user
    // never made, on a prompt deliberately given no timeout for exactly that reason.
    const runtime = await withWorkspace(appId, (workspace) => workspace.runtime)
    // A turn that is still queued has no host to abort and no approvals to deny —
    // it has not touched the daemon at all. Without this, Stop on a queued turn
    // does nothing visible and the turn starts anyway the moment the app ahead
    // finishes, which reads as a Stop button that was ignored.
    inferenceQueue.cancel(runtime.appId)
    denyPendingApprovals(runtime.appId)
    await runtime.host?.abort()
  })

  // What the context window holds, attributed to blocks the user can act on
  ipcMain.handle('agent:get-context-report', async (_, appId: unknown): Promise<ContextReport | null> => {
    if (appId === null || appId === undefined) return null
    const { app, runtime } = await withWorkspace(appId, (workspace) => workspace)

    // Deliberately not `ensureAgentHost`. Building a host warms the model, and this
    // handler runs whenever the chat panel mounts — including on the panel switch the
    // user made precisely because they did not want to wait for the agent.
    //
    // The old cross-check on the host's app id is gone, and could not be written
    // now if it were wanted: the host is read off *this workspace's* runtime, so a
    // report can no longer be taken from a host bound to a different app.
    if (runtime.host) {
      const report = await runtime.host.getContextReport()
      runtime.cachedReport = report
      return report
    }

    const config = getConfig()
    const budget = lastBudget ?? deriveContextBudget({ userOverride: config.contextWindow })

    const floor = await buildContextReport({
      app,
      budget,
      toolNames: resolveToolNames({
        profile: config.toolProfile,
        contextWindow: budget.window
      }),
      builtinToolNames: PI_BUILTIN_TOOL_NAMES,
      mcpSources: sourceManager.getConnectedSources().filter((source) => source.connected)
    })

    // A remembered conversation is still the best answer available, but its fixed half
    // is stale by exactly the change that disposed the host — a skill toggled off, a
    // source disconnected. So the fixed blocks are taken fresh and only the
    // conversation is carried over, and the state says the number is not current.
    if (!runtime.cachedReport) return floor

    const carried = runtime.cachedReport.blocks.filter(
      (block) => block.group === 'conversation'
    )
    if (carried.length === 0) return floor

    const blocks = [...floor.blocks, ...carried]

    return {
      ...floor,
      state: 'stale',
      measured: runtime.cachedReport.measured,
      estimated: blocks.reduce((sum, block) => sum + block.tokens, 0),
      blocks,
      hotspots: runtime.cachedReport.hotspots
    }
  })

  // What the daemon has been asked to do for the conversation on screen
  //
  // Deliberately not `ensureAgentHost`, for exactly the reason `agent:get-context-report`
  // is not: building a host warms the model, and this runs whenever the Activity panel
  // mounts. The recorder lives on the runtime and survives `disposeAgentHost`, so
  // answering without a host is the correct answer rather than a degraded one — the
  // recorder measures the conversation, and the conversation is what is on screen.
  //
  // No arguments, so there is nothing to validate. `snapshot()` copies its records and
  // its totals, so what crosses the bridge is already detached from the live recorder.
  ipcMain.handle('agent:get-telemetry', async (_, appId: unknown): Promise<TelemetrySnapshot> => {
    return withWorkspace(appId, ({ runtime }) => runtime.telemetry.snapshot())
  })

  // Summarize the conversation now rather than at the threshold
  ipcMain.handle('agent:compact', async (_, appId: unknown): Promise<void> => {
    const runtime = await withWorkspace(appId, (workspace) => workspace.runtime)
    if (!runtime.host) throw new Error('No conversation to compact yet.')
    refuseWhileRunning(runtime, 'summarizing')
    await runtime.host.compact()
  })

  // Handle tool approval response from renderer
  ipcMain.on('agent:tool-response', (_, response: ToolApprovalResponse): void => {
    // This is the approval gate for the entire permission system, so the payload
    // is validated strictly: a truthy non-boolean must not read as approval.
    if (!response || typeof response !== 'object') return
    if (typeof response.id !== 'string' || response.id.length === 0) return
    if (typeof response.approved !== 'boolean') return

    const pending = pendingApprovals.get(response.id)
    if (pending) {
      pendingApprovals.delete(response.id)
      pending.resolve(response.approved)
    }
  })

  // Version control IPC handlers.
  //
  // Every one of these takes an app *id* now, not a path. Two reasons, and the
  // second is the important one. A path had to be matched against `listApps()` on
  // every call to prove it was real, which is a `statusMatrix` per app to answer a
  // question `AppManager.appDir` answers from the id alone. And the id was optional,
  // falling back to "whichever app is active" — harmless while only one could be
  // open, and with several mounted it is a rollback aimed at the app you were
  // looking at a moment ago. `withWorkspace` refuses rather than guesses.
  ipcMain.handle('version:get-state', async (_, appId: unknown) =>
    withWorkspace(appId, ({ root }) => new VersionManager(root).getState())
  )

  ipcMain.handle('version:get-branches', async (_, appId: unknown) =>
    withWorkspace(appId, ({ root }) => new VersionManager(root).listBranches())
  )

  ipcMain.handle('version:get-history', async (_, depth: unknown, appId: unknown) =>
    withWorkspace(appId, ({ root }) =>
      new VersionManager(root).getHistory({
        depth: typeof depth === 'number' && Number.isInteger(depth) && depth > 0 ? depth : undefined
      })
    )
  )

  ipcMain.handle('version:switch-branch', async (_, name: unknown, appId: unknown) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    return withWorkspace(appId, ({ root, runtime }) => {
      refuseWhileRunning(runtime, 'switching branch')
      return new VersionManager(root).switchBranch(name)
    })
  })

  ipcMain.handle('version:create-branch', async (_, name: unknown, appId: unknown) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    return withWorkspace(appId, ({ root }) => new VersionManager(root).createBranch({ name }))
  })

  ipcMain.handle('version:rollback', async (_, oid: unknown, appId: unknown) => {
    if (typeof oid !== 'string' || oid.length === 0) {
      throw new Error('Invalid commit OID')
    }
    return withWorkspace(appId, ({ root, runtime }) => {
      refuseWhileRunning(runtime, 'rolling back')
      return new VersionManager(root).rollback(oid)
    })
  })

  ipcMain.handle('version:diff', async (_, from: unknown, to: unknown, appId: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new Error('Invalid commit OIDs')
    }
    return withWorkspace(appId, ({ root }) => new VersionManager(root).diff(from, to))
  })

  /**
   * The commit a chat session started from, for the composer's changed-files strip.
   *
   * Takes an app *id* rather than a path: the id goes to `AppManager.getApp`, which
   * validates it where it becomes a path, so there is no path here for the renderer
   * to spell wrong. Recording is idempotent and first-write-wins, so calling this on
   * every strip refresh cannot walk the baseline forward.
   */
  ipcMain.handle('changes:session-baseline', async (_, appId: unknown, sessionId: unknown) => {
    if (typeof appId !== 'string' || !isValidAppId(appId)) {
      throw new Error('Invalid app ID')
    }
    assertSessionId(sessionId)
    const stored = await readSessionBaseline({ storePath: baselinePath, appId, sessionId })
    return stored ?? (await captureSessionBaseline(appId, sessionId))
  })

  /**
   * The sub-app's source tree, for the code panel.
   *
   * Confinement comes from `files.ts`, which uses the same `isWithinRoot` the agent's
   * gate uses — so the tree can never show a file the agent could not reach.
   */
  ipcMain.handle('files:tree', async (_, appId: unknown) => {
    return withWorkspace(appId, ({ root }) => listAppFiles(root))
  })

  ipcMain.handle('files:read', async (_, filePath: unknown, appId: unknown) => {
    // The renderer is untrusted. Length is bounded here as well as type, so a path built
    // by a runaway loop cannot be handed to the filesystem.
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new Error('Invalid file path')
    }
    return withWorkspace(appId, ({ root }) => readAppFile({ rootPath: root, path: filePath }))
  })

  /**
   * Compiler errors for one file, for the code viewer's squiggles.
   *
   * Deliberately the *same* service the agent's writes are checked against — borrowed
   * from the registry rather than started separately — so the human and the model are
   * never shown two different accounts of whether the code compiles.
   */
  ipcMain.handle('files:diagnostics', async (_, filePath: unknown, appId: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new Error('Invalid file path')
    }

    return withWorkspace(appId, async ({ root }) => {
      const lease = acquireTsService(root)
      try {
        await lease.client.request({ kind: 'invalidate', paths: [filePath] })
        const response = await lease.client.request({ kind: 'diagnostics', path: filePath })
        // Anything but a diagnostics answer means the service could not say — an app with
        // no TypeScript in it, a crashed worker. The viewer shows no squiggles, which is
        // the truthful rendering of "no information".
        return response.kind === 'diagnostics' ? response.diagnostics : []
      } finally {
        lease.release()
      }
    })
  })

  // App management IPC handlers
  ipcMain.handle('apps:list', async () => {
    return appManager.listApps()
  })

  ipcMain.handle('apps:get', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    return appManager.getApp(id)
  })

  ipcMain.handle('apps:create', async (_, params: CreateAppParams) => {
    if (!params || typeof params.name !== 'string' || params.name.length === 0) {
      throw new Error('Invalid app name')
    }
    if (!params.template) {
      throw new Error('Template is required')
    }
    return appManager.createApp(params)
  })

  ipcMain.handle('apps:delete', async (_, id: string) => {
    // `isValidAppId`, not just a non-empty string: this id reaches `getAppPath` through
    // `listSessions` below, and `deleteApp` turns it into the path of a recursive `rm`.
    if (typeof id !== 'string' || !isValidAppId(id)) {
      throw new Error('Invalid app ID')
    }
    // The app's chats go with it, so their skill-load counts are dead keys. Best-effort:
    // an unreadable session list is not a reason to refuse to delete the app.
    try {
      forgetSkillLoads((await chatHistoryManager.listSessions(id)).map((session) => session.id))
    } catch {
      // The counts are a display detail; the app still goes.
    }

    // The deleted app's runtime goes with it — its host, its transcript pointer and
    // its telemetry describe a directory that is about to stop existing. Disposing
    // before dropping, so a live Pi session is not orphaned holding open files under
    // a tree the recursive `rm` is about to take.
    // Including a turn still waiting its place in the queue: it would otherwise
    // start against a directory that no longer exists the moment the app ahead
    // of it finished.
    inferenceQueue.cancel(id)
    const runtime = existingRuntime(id)
    if (runtime) {
      await disposeAgentHost(runtime)
      dropRuntime(id)
    }
    return appManager.deleteApp(id)
  })

  ipcMain.handle('apps:update', async (_, id: string, updates: { name?: string; description?: string }) => {
    if (typeof id !== 'string' || !isValidAppId(id)) {
      throw new Error('Invalid app ID')
    }
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid updates')
    }
    return appManager.updateApp(id, updates)
  })

  // Focus an app — which no longer means tearing anything down.
  //
  // This used to dispose the agent session and forget the conversation on every
  // call, because with one host and one report slot, keeping A's state meant B
  // could not have any. Each app owns its own runtime now, so focusing is just
  // focusing: the previous app keeps its live session, its context report and its
  // telemetry, and returning to it is instant instead of a fresh model warm.
  //
  // That also fixes a visible bug on its own. `disposeAgentHost` ran here on every
  // navigation to the Apps page, so the context meter blinked out and back several
  // times a minute during ordinary use.
  // Which app the window is showing. Focus and nothing else.
  //
  // It used to also bootstrap the workspace — load the chat manifest, pick a session
  // and push it — which was fine while exactly one workspace could exist. With
  // several mounted, bootstrapping only the focused one leaves the others with no
  // session, and re-bootstrapping on every focus change would re-push a transcript
  // the panel already has. `workspace:open` does that job, once per workspace.
  ipcMain.handle('apps:set-active', async (_, id: string | null) => {
    if (id === null) {
      setFocusedAppId(null)
      return null
    }

    // Validation is `withWorkspace`'s, which is the single place an id becomes a
    // root — so focus can only ever be set to an app that has already been proven
    // to resolve inside the apps root, and `getFocusedAppId` never answers with an
    // id nothing else would accept.
    return withWorkspace(id, ({ app }) => {
      setFocusedAppId(app.id)
      return app.id
    })
  })

  /**
   * Bring a workspace up: resolve its chat session and push its transcript.
   *
   * Called once per mounted workspace rather than on focus, because with several
   * mounted the two are no longer the same event. Idempotent — it resolves the
   * session the manifest already names and only creates one when there is none —
   * so a remount replays the same answer rather than starting a new conversation.
   */
  ipcMain.handle('workspace:open', async (_, appId: unknown) => {
    return withWorkspace(appId, async ({ app, runtime }) => {
      // Load manifest (triggers migration if needed)
      const manifest = await chatHistoryManager.loadManifest(app.id)

      // Auto-create the first session if none exist. It is deliberately created
      // with no title, so its name is derived from the first message rather than
      // frozen at 'Chat' forever.
      if (manifest.sessions.length === 0) {
        const session = await chatHistoryManager.createSession(app.id)
        runtime.activeSessionId = session.id
        sendSessionChanged(mainWindow, app.id, session.id, [])
      } else {
        runtime.activeSessionId = manifest.activeSessionId

        const history = runtime.activeSessionId
          ? await chatHistoryManager.loadHistory(app.id, runtime.activeSessionId)
          : []
        sendSessionChanged(mainWindow, app.id, runtime.activeSessionId, history)
      }

      await broadcastSessions(mainWindow, app.id)
      return runtime.activeSessionId
    })
  })

  ipcMain.handle('apps:get-active', async () => {
    return getFocusedAppId()
  })

  ipcMain.handle('apps:get-active-details', async () => {
    return getActiveApp()
  })

  // Sources IPC handlers
  ipcMain.handle('sources:list', async () => {
    return sourceManager.getConnectedSources()
  })

  ipcMain.handle('sources:load-configs', async () => {
    return sourceManager.loadSources()
  })

  ipcMain.handle('sources:save', async (_, config: unknown) => {
    const validated = validateMcpSourceConfig(config)
    await sourceManager.saveSource(validated)
    // The saved command and args become both a spawned process and an agent tool
    // surface, so drop the session and let the next prompt rebuild it.
    await disposeAllAgentHosts()
  })

  ipcMain.handle('sources:connect', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    const configs = await sourceManager.loadSources()
    const config = configs.find((c) => c.id === id)
    if (!config) {
      throw new Error(`Source ${id} not found`)
    }
    const connected = await sourceManager.connect(config)
    // Pi's tool list is fixed at session creation, so rebuild to pick up the tools.
    await disposeAllAgentHosts()
    return connected
  })

  ipcMain.handle('sources:disconnect', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    await sourceManager.disconnect(id)
    await disposeAllAgentHosts()
  })

  ipcMain.handle('sources:delete', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    await sourceManager.deleteSource(id)
    await disposeAllAgentHosts()
  })

  // Skills IPC handlers
  // The skills channels take an app id, and `null` genuinely means "no app" — the
  // workspace library is editable from Settings with nothing open. Passing the
  // workspace down rather than re-deriving it inside each helper is what stops
  // `loaderForScope` and `commitAppSkill`, both of which turn a scope into a
  // directory that gets written, from being pointed by a global.
  ipcMain.handle('skills:list', async (_, appId: unknown): Promise<SkillLibrary> => {
    return loadSkillLibrary(await optionalWorkspace(appId))
  })

  ipcMain.handle(
    'skills:save',
    async (_, request: unknown, appId: unknown): Promise<SkillLibraryUpdate> => {
      const workspace = await optionalWorkspace(appId)
      const { scope, draft } = parseSkillWrite(request)
      await loaderForScope(scope, workspace).save(draft)
      const warning = await commitAppSkill(scope, draft.name, 'write', workspace)
      await disposeAllAgentHosts()
      return { library: await loadSkillLibrary(workspace), warning }
    }
  )

  ipcMain.handle(
    'skills:delete',
    async (_, request: unknown, appId: unknown): Promise<SkillLibraryUpdate> => {
      const workspace = await optionalWorkspace(appId)
      const { scope, name } = parseSkillRef(request)
      await loaderForScope(scope, workspace).delete(name)
      const warning = await commitAppSkill(scope, name, 'delete', workspace)
      await disposeAllAgentHosts()
      return { library: await loadSkillLibrary(workspace), warning }
    }
  )

  ipcMain.handle(
    'skills:set-enabled',
    async (_, request: unknown, appId: unknown): Promise<SkillLibrary> => {
    if (typeof request !== 'object' || request === null) {
      throw new Error('Invalid request')
    }
    const { name, enabled } = request as { name?: unknown; enabled?: unknown }
    if (!isValidSkillName(name) || typeof enabled !== 'boolean') {
      throw new Error('Invalid skill name or state')
    }

    // Not optional here: on/off is `SubApp.disabledSkills`, so this one genuinely
    // needs an app to belong to.
    const workspace = await withWorkspace(appId, (resolved) => resolved)
    const { app } = workspace

    const disabled = new Set(app.disabledSkills ?? [])
    if (enabled) disabled.delete(name)
    else disabled.add(name)

    await appManager.updateApp(app.id, { disabledSkills: [...disabled].sort() })
    await disposeAllAgentHosts()
    // Re-resolved, not reused: `updateApp` rewrote `disabledSkills`, and the record
    // captured above still carries the old set — building the library from it would
    // answer with the state before the toggle.
    return withWorkspace(app.id, (refreshed) => loadSkillLibrary(refreshed))
    }
  )

  // Workspace layout IPC handlers
  ipcMain.handle('layout:get', async (_, appId: unknown, version: unknown) => {
    if (typeof appId !== 'string' || !isValidAppId(appId)) {
      throw new Error('Invalid app ID')
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new Error('Invalid layout version')
    }
    return readWorkspaceLayout({ storePath: layoutPath, appId, version })
  })

  ipcMain.handle(
    'layout:save',
    async (_, appId: unknown, version: unknown, layout: unknown) => {
      if (typeof appId !== 'string' || !isValidAppId(appId)) {
        throw new Error('Invalid app ID')
      }
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
        throw new Error('Invalid layout version')
      }
      // `readdir`, not `appManager.listApps()`: listing layers git status onto
      // every app, and this runs on every debounced save — that is a
      // `statusMatrix` per app per drag. Pruning only needs the names.
      const entries = await fs.readdir(appManager.getAppsDir(), { withFileTypes: true })
      return writeWorkspaceLayout({
        storePath: layoutPath,
        appId,
        version,
        layout,
        liveAppIds: entries.filter((e) => e.isDirectory()).map((e) => e.name)
      })
    }
  )

  // Open-app set IPC handlers
  //
  // `readdir`, not `appManager.listApps()`, for the same reason `layout:save`
  // gives: listing layers a `statusMatrix` onto every app, and pruning only
  // needs the names.
  async function liveAppIds(): Promise<string[]> {
    const entries = await fs.readdir(appManager.getAppsDir(), { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  }

  ipcMain.handle('workspaces:get-open', async (): Promise<OpenAppsState> => {
    return readOpenApps({ storePath: openAppsPath, liveAppIds: await liveAppIds() })
  })

  ipcMain.handle('workspaces:set-open', async (_, state: unknown) => {
    if (typeof state !== 'object' || state === null) {
      throw new Error('Invalid open apps state')
    }
    const { openAppIds, focusedAppId } = state as Partial<OpenAppsState>
    if (!Array.isArray(openAppIds) || openAppIds.length > 64) {
      throw new Error('Invalid open apps state')
    }
    // Every id is checked here as well as filtered against the live set below:
    // `isValidAppId` is what keeps a value that is about to be written, read
    // back on the next launch, and turned into a path from ever being one that
    // escapes the apps root.
    for (const id of openAppIds) {
      if (typeof id !== 'string' || !isValidAppId(id)) {
        throw new Error('Invalid app ID')
      }
    }
    if (focusedAppId !== null && focusedAppId !== undefined) {
      if (typeof focusedAppId !== 'string' || !isValidAppId(focusedAppId)) {
        throw new Error('Invalid app ID')
      }
    }
    return writeOpenApps({
      storePath: openAppsPath,
      state: { openAppIds, focusedAppId: focusedAppId ?? null },
      liveAppIds: await liveAppIds()
    })
  })

  // Config IPC handlers
  ipcMain.handle('config:get', async () => {
    return loadConfig()
  })

  ipcMain.handle('config:save', async (_, config: AppConfig) => {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config')
    }
    if (typeof config.ollamaBaseUrl !== 'string' || config.ollamaBaseUrl.length > 2048) {
      throw new Error('Invalid Ollama base URL')
    }
    // A length check is not a URL check. This value is joined with `/api/...` paths and
    // fetched, so anything that is not http(s) — a `file:` URL, a `javascript:` one, or
    // a string that does not parse at all — is refused here rather than becoming a
    // request whose failure looks like an unreachable daemon.
    if (!isHttpUrl(config.ollamaBaseUrl)) {
      throw new Error('Invalid Ollama base URL')
    }
    if (
      config.ollamaModel !== null &&
      (typeof config.ollamaModel !== 'string' || config.ollamaModel.length > 256)
    ) {
      throw new Error('Invalid model id')
    }
    if (!['light', 'dark', 'system'].includes(config.theme)) {
      throw new Error('Invalid theme')
    }
    if (typeof config.autoCommit !== 'boolean') {
      throw new Error('Invalid autoCommit')
    }
    if (typeof config.autoTitleChats !== 'boolean') {
      throw new Error('Invalid autoTitleChats')
    }
    // Bounded by the same numbers the derivation clamps to. A wider bound here is
    // not more permissive, only less honest: the value is accepted, persisted, shown
    // back in Settings, and then silently clamped on the way to the model.
    if (
      config.contextWindow !== null &&
      (typeof config.contextWindow !== 'number' ||
        !Number.isFinite(config.contextWindow) ||
        config.contextWindow < MIN_CONTEXT_WINDOW ||
        config.contextWindow > MAX_CONTEXT_WINDOW)
    ) {
      throw new Error('Invalid context window')
    }
    if (!['auto', 'lean', 'full'].includes(config.toolProfile)) {
      throw new Error('Invalid tool profile')
    }
    if (typeof config.trimContext !== 'boolean') {
      throw new Error('Invalid trimContext')
    }
    // Bounded by what the OpenAI-compatible endpoint accepts. `null` is the deliberate
    // "send nothing" value and is not the same as 0; `'auto'` asks Pi Taster to choose.
    if (!isValidSampling(config.samplingTemperature, MIN_SAMPLING_TEMPERATURE, MAX_SAMPLING_TEMPERATURE)) {
      throw new Error('Invalid sampling temperature')
    }
    if (!isValidSampling(config.samplingTopP, MIN_SAMPLING_TOP_P, MAX_SAMPLING_TOP_P)) {
      throw new Error('Invalid sampling top_p')
    }
    // An allowlist rather than a string check: this value reaches Pi as a
    // `thinkingLevel` and then the daemon as `reasoning_effort`, and the renderer is
    // untrusted.
    if (!REASONING_LEVELS.includes(config.reasoningLevel)) {
      throw new Error('Invalid reasoning level')
    }
    await saveConfig(config)
    // Every setting on this page is read once, when the host is built: the reasoning
    // level and the temperature reach Pi through `createAgentSession`, the tool
    // profile fixes the tool list, and the window override rewrites `models.json`.
    // Without this a saved change did nothing until some unrelated action — a skills
    // save, an app switch — happened to dispose the host, which is indistinguishable
    // from a control that does not work. Deliberately *not* paired with
    // `forgetCachedReport` or `forgetSessionTelemetry`: the conversation this
    // disposes is still the one on screen, and its numbers still describe it.
    //
    // Every workspace, not just the focused one: each host reads the config once,
    // when it is built, so a background app would otherwise keep running under the
    // settings that were in force when it was last prompted.
    await disposeAllAgentHosts()
  })

  /**
   * Whether the daemon is answering, and whether it still holds the selected model.
   *
   * Cheap enough to poll: one `/api/ps` against a local daemon, with the same short
   * timeout as every other discovery call. It exists outside Settings because that is
   * the one place a person is *not* looking when a turn fails to start.
   */
  ipcMain.handle('daemon:health', async (): Promise<DaemonHealth> => {
    const config = getConfig()
    return readDaemonHealth({ baseUrl: config.ollamaBaseUrl, modelId: config.ollamaModel })
  })

  /**
   * List the models pulled into the local Ollama daemon, refreshing Pi's catalog.
   */
  ipcMain.handle('models:list', async (): Promise<OllamaModel[]> => {
    const config = getConfig()
    return syncOllamaModels({
      agentDir: piAgentDir,
      baseUrl: config.ollamaBaseUrl,
      selectedModel: config.ollamaModel,
      contextWindowOverride: config.contextWindow
    })
  })

  /**
   * Report whether the configured Ollama daemon is answering.
   */
  ipcMain.handle('models:check-connection', async (_, baseUrl?: string): Promise<boolean> => {
    if (baseUrl !== undefined && (typeof baseUrl !== 'string' || baseUrl.length > 2048)) {
      throw new Error('Invalid Ollama base URL')
    }
    return isOllamaReachable(baseUrl ?? getConfig().ollamaBaseUrl)
  })

  // Chat history IPC handlers (session-aware)
  ipcMain.handle('chat:load-history', async (_, appId: unknown): Promise<ChatHistoryPayload> => {
    const runtime = await withWorkspace(appId, (workspace) => workspace.runtime)
    if (!runtime.activeSessionId) return { sessionId: null, messages: [] }
    return {
      sessionId: runtime.activeSessionId,
      messages: await chatHistoryManager.loadHistory(runtime.appId, runtime.activeSessionId)
    }
  })

  ipcMain.handle('chat:clear-history', async (_, appId: unknown) => {
    const { app, runtime } = await withWorkspace(appId, (workspace) => workspace)
    if (!runtime.activeSessionId) {
      throw new Error('No active session')
    }
    await chatHistoryManager.clearHistory(app.id, runtime.activeSessionId)
    await disposeAgentHost(runtime)
    forgetCachedReport(runtime)
    forgetSessionTelemetry(runtime)
  })

  // Chat session IPC handlers
  ipcMain.handle('sessions:list', async (_, appId: unknown) => {
    return withWorkspace(appId, ({ app }) => chatHistoryManager.listSessions(app.id))
  })

  ipcMain.handle('sessions:create', async (_, params: CreateChatSessionParams | undefined, appId: unknown) => {
    const { app, runtime } = await withWorkspace(appId, (workspace) => workspace)

    const session = await chatHistoryManager.createSession(app.id, params)

    // Switch to the new session
    runtime.activeSessionId = session.id
    await disposeAgentHost(runtime)
    forgetCachedReport(runtime)
    forgetSessionTelemetry(runtime)

    // Notify renderer
    sendSessionChanged(mainWindow, app.id, session.id, [])
    await broadcastSessions(mainWindow, app.id)

    return session
  })

  ipcMain.handle('sessions:delete', async (_, sessionId: string, appId: unknown) => {
    const { app, runtime } = await withWorkspace(appId, (workspace) => workspace)
    assertSessionId(sessionId)

    await chatHistoryManager.deleteSession(app.id, sessionId)
    forgetSkillLoads([sessionId])

    // If we deleted the active session, load the new active
    if (runtime.activeSessionId === sessionId) {
      const newActiveId = await chatHistoryManager.getActiveSessionId(app.id)
      runtime.activeSessionId = newActiveId
      await disposeAgentHost(runtime)
      forgetCachedReport(runtime)
      forgetSessionTelemetry(runtime)

      const history = newActiveId
        ? await chatHistoryManager.loadHistory(app.id, newActiveId)
        : []
      sendSessionChanged(mainWindow, app.id, newActiveId, history)
    }

    await broadcastSessions(mainWindow, app.id)
  })

  ipcMain.handle('sessions:rename', async (_, sessionId: string, title: string, appId: unknown) => {
    const { app } = await withWorkspace(appId, (workspace) => workspace)
    assertSessionId(sessionId)
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error('Invalid title')
    }
    const renamed = await chatHistoryManager.renameSession(app.id, sessionId, title)
    await broadcastSessions(mainWindow, app.id)
    return renamed
  })

  ipcMain.handle('sessions:set-active', async (_, sessionId: string, appId: unknown) => {
    const { app, runtime } = await withWorkspace(appId, (workspace) => workspace)
    assertSessionId(sessionId)

    // `assertSessionId` bounds the shape; it says nothing about whose session this is.
    // That is the same distinction `apps:set-active` draws — not "is it a non-empty
    // string" but "is it a thing that exists" — and the gap here was load-bearing:
    // the id lands in the *active* app's `.chat-sessions.json`, so a click on a session
    // row that arrives while the active app is changing files one app's session under
    // another. A real install was found holding exactly that, and because `loadManifest`
    // masks a pointer it cannot resolve by falling back to the newest real session, the
    // bad pointer survives on disk indefinitely with no symptom to notice.
    //
    // Ignored rather than thrown, because the losing race is not the user's mistake and
    // nothing is wrong that a fresh list does not fix. Re-broadcasting is the repair:
    // the stale list that produced the click is what gets replaced.
    if (!(await chatHistoryManager.getSessionPath(app.id, sessionId))) {
      console.warn(
        `Ignoring a request to activate session ${sessionId}, which does not belong to app ${app.id}`
      )
      await broadcastSessions(mainWindow, app.id)
      sendSessionChanged(
        mainWindow,
        app.id,
        runtime.activeSessionId,
        runtime.activeSessionId
          ? await chatHistoryManager.loadHistory(app.id, runtime.activeSessionId)
          : []
      )
      return
    }

    const changed = sessionId !== runtime.activeSessionId
    await chatHistoryManager.setActiveSession(app.id, sessionId)
    runtime.activeSessionId = sessionId
    await disposeAgentHost(runtime)
    // Only when the session actually changes, for the reason `apps:set-active` gives:
    // clicking the chat you are already in is an ordinary navigation, and forgetting
    // there would reset the Activity panel and drop the context meter to its fixed
    // floor for a trip the user made to return to the very conversation they describe.
    if (changed) {
      forgetCachedReport(runtime)
      forgetSessionTelemetry(runtime)
    }

    // Load history for the new session
    const history = await chatHistoryManager.loadHistory(app.id, sessionId)
    sendSessionChanged(mainWindow, app.id, sessionId, history)
  })

  ipcMain.handle('sessions:get-active', async (_, appId: unknown) => {
    return withWorkspace(appId, ({ runtime }) => runtime.activeSessionId)
  })

  // App runner IPC handlers

  // Set up event forwarding from AppRunner to renderer
  appRunner.on('log', (entry: AppLogEntry) => {
    mainWindow.webContents.send('apps:log', entry)
  })

  appRunner.on('status', (change: AppStatusChange) => {
    mainWindow.webContents.send('apps:status-change', change)
  })

  ipcMain.handle('apps:run', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }

    const app = await appManager.getApp(id)
    if (!app) {
      throw new Error(`App "${id}" not found`)
    }

    if (!appRunner.isRunnable(app.template)) {
      throw new Error(`Template "${app.template}" is not runnable`)
    }

    return appRunner.start(id, app.path, app.template)
  })

  ipcMain.handle('apps:stop', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    return appRunner.stop(id)
  })

  ipcMain.handle('apps:get-running', async () => {
    const running = appRunner.getRunning()
    // Convert Map to array for IPC serialization
    return Array.from(running.entries()).map(([id, info]) => ({ id, ...info }))
  })

  ipcMain.handle('apps:is-running', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    return appRunner.isRunning(id)
  })

  ipcMain.handle('apps:get-running-info', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    return appRunner.getRunningApp(id)
  })

  ipcMain.handle('apps:open-browser', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }

    const info = appRunner.getRunningApp(id)
    if (!info?.url) {
      throw new Error(`App "${id}" is not running or has no URL`)
    }

    await shell.openExternal(info.url)
  })

  // Links in the chat transcript are written by the model, so the URL arriving
  // here is untrusted. `openExternalUrl` validates it before the OS sees it.
  ipcMain.handle('shell:open-external', async (_, url: unknown) => {
    await openExternalUrl(url)
  })

  ipcMain.handle('apps:install-deps', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }

    // Through the funnel like every other app-addressed channel, rather than
    // calling `getApp` directly. The guard is the same one either way — `getApp`
    // routes through `appDir` — but a boundary is only auditable if there is one
    // place to audit, and an exception here is an exception the next reader has
    // to re-derive the safety of.
    const { app, runtime } = await withWorkspace(id, (workspace) => workspace)

    // `bun install` rewrites `node_modules` and can rewrite `package.json`, both
    // of which a mid-turn agent may be reading — and it runs the project's own
    // install scripts, which is why `install_deps` is never auto-approved either.
    refuseWhileRunning(runtime, 'installing dependencies')

    // `installDependencies` spawns with a filtered environment, so the user's
    // API keys never reach the install process.
    const result = await installDependencies({
      appPath: app.path,
      onLog: ({ type, message }) => {
        const entry: AppLogEntry = {
          appId: id,
          timestamp: new Date().toISOString(),
          type,
          message
        }
        mainWindow.webContents.send('apps:log', entry)
      }
    })

    if (result.exitCode !== 0) {
      throw new Error(`bun install exited with code ${result.exitCode}`)
    }
  })

  /**
   * Load the inspector overlay script as a string.
   */
  ipcMain.handle('inspector:get-script', async () => {
    try {
      // Read the compiled inspector script
      const scriptPath = join(moduleDir, '../../packages/shared/dist/inspector/overlay.js')
      const script = await fs.readFile(scriptPath, 'utf-8')
      return script
    } catch (err) {
      console.error('Failed to load inspector script:', err)
      throw new Error('Inspector script not found')
    }
  })

  /**
   * Capture element screenshot.
   */
  ipcMain.handle(
    'inspector:capture-element',
    async (event, elementInfo: ElementInfo) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) throw new Error('Window not found')

        const elementContext = await captureElement(window, elementInfo)
        return elementContext
      } catch (err) {
        console.error('Element capture failed:', err)
        throw err
      }
    }
  )

  /**
   * Add element context to the current chat.
   */
  ipcMain.handle('chat:add-element-context', async (event, context: ElementContext) => {
    // Tagged with the focused app: the element was picked in that workspace's
    // Preview, so it belongs in that workspace's composer and no other.
    const appId = getFocusedAppId()
    // Notify all renderer windows to inject element context
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('chat:element-context-added', { appId, context })
    })
  })
}

/**
 * Clean up IPC handlers when the window is destroyed.
 */
export function cleanupIpcHandlers(): void {
  ipcMain.removeHandler('permissions:get-mode')
  ipcMain.removeHandler('permissions:set-mode')
  ipcMain.removeHandler('agent:clear-history')
  ipcMain.removeHandler('agent:message')
  ipcMain.removeHandler('daemon:health')
  ipcMain.removeHandler('agent:abort')
  ipcMain.removeHandler('agent:get-context-report')
  ipcMain.removeHandler('agent:get-telemetry')
  ipcMain.removeHandler('agent:compact')
  ipcMain.removeHandler('models:list')
  ipcMain.removeHandler('models:check-connection')
  ipcMain.removeAllListeners('agent:tool-response')
  
  // Version control handlers
  ipcMain.removeHandler('version:get-state')
  ipcMain.removeHandler('version:get-branches')
  ipcMain.removeHandler('version:get-history')
  ipcMain.removeHandler('version:switch-branch')
  ipcMain.removeHandler('version:create-branch')
  ipcMain.removeHandler('version:rollback')
  ipcMain.removeHandler('version:diff')
  ipcMain.removeHandler('files:tree')
  ipcMain.removeHandler('files:read')
  ipcMain.removeHandler('files:diagnostics')

  // App management handlers
  ipcMain.removeHandler('apps:list')
  ipcMain.removeHandler('apps:get')
  ipcMain.removeHandler('apps:create')
  ipcMain.removeHandler('apps:delete')
  ipcMain.removeHandler('apps:update')
  ipcMain.removeHandler('apps:set-active')
  ipcMain.removeHandler('workspace:open')
  ipcMain.removeHandler('apps:get-active')
  ipcMain.removeHandler('apps:get-active-details')

  // App runner handlers
  ipcMain.removeHandler('apps:run')
  ipcMain.removeHandler('apps:stop')
  ipcMain.removeHandler('apps:get-running')
  ipcMain.removeHandler('apps:is-running')
  ipcMain.removeHandler('apps:get-running-info')
  ipcMain.removeHandler('apps:open-browser')
  ipcMain.removeHandler('shell:open-external')
  ipcMain.removeHandler('apps:install-deps')

  // Stop all running apps on cleanup
  appRunner.stopAll().catch(() => {})
  appRunner.removeAllListeners()

  // Sources handlers
  ipcMain.removeHandler('sources:list')
  ipcMain.removeHandler('sources:load-configs')
  ipcMain.removeHandler('sources:save')
  ipcMain.removeHandler('sources:connect')
  ipcMain.removeHandler('sources:disconnect')
  ipcMain.removeHandler('sources:delete')

  // Skills handlers
  ipcMain.removeHandler('skills:list')
  ipcMain.removeHandler('skills:save')
  ipcMain.removeHandler('skills:delete')
  ipcMain.removeHandler('skills:set-enabled')

  // Workspace layout handlers
  ipcMain.removeHandler('layout:get')
  ipcMain.removeHandler('layout:save')
  ipcMain.removeHandler('workspaces:get-open')
  ipcMain.removeHandler('workspaces:set-open')

  // Config handlers
  ipcMain.removeHandler('config:get')
  ipcMain.removeHandler('config:save')

  // Chat history handlers
  ipcMain.removeHandler('chat:load-history')
  ipcMain.removeHandler('chat:clear-history')

  // Session handlers
  ipcMain.removeHandler('sessions:list')
  ipcMain.removeHandler('sessions:create')
  ipcMain.removeHandler('sessions:delete')
  ipcMain.removeHandler('sessions:rename')
  ipcMain.removeHandler('sessions:set-active')
  ipcMain.removeHandler('sessions:get-active')

  // Inspector handlers
  ipcMain.removeHandler('inspector:get-script')
  ipcMain.removeHandler('inspector:capture-element')
  ipcMain.removeHandler('chat:add-element-context')

  // Tear down every agent session.
  //
  // Queued turns first: `disposeAllAgentHosts` now *spares* a workspace mid-turn
  // rather than disposing it, so on teardown a queued turn would be handed the
  // daemon by the very turn that is ending, into a window that has gone.
  for (const runtime of allRuntimes()) {
    inferenceQueue.cancel(runtime.appId)
  }
  void disposeAllAgentHosts({ force: true })

  // Drop every workspace: focus, session pointers, reports and telemetry all go
  // with the window they described.
  dropAllRuntimes()

  // Disconnect all sources
  sourceManager.disconnectAll().catch(() => {})
  
  // Deny, not reject: a rejection throws inside the `tool_call` handler that is
  // awaiting it, which risks an unhandled rejection during teardown. Closing the
  // window is a denial like any other.
  denyPendingApprovals()
}
