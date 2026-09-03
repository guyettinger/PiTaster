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
  DEFAULT_SAMPLING_TEMPERATURE,
  MAX_SAMPLING_TEMPERATURE,
  MIN_SAMPLING_TEMPERATURE,
  PI_BUILTIN_TOOL_NAMES,
  type AgentHost
} from './agent/session'
import { buildContextReport } from './agent/context-report'
import { readWorkspaceLayout, writeWorkspaceLayout } from './layout-store'
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
} from '@anyapp/shared'
import type { AgentStatus, ContextReport, PermissionMode, StreamChunk, SkillDraft, SkillLibrary, SkillLibraryUpdate, SkillScope, CreateAppParams, SubApp, AppLogEntry, AppStatusChange, RunningApp, PersistedMessage, ChatHistoryPayload, ChatSession, CreateChatSessionParams, SerializedContentBlock, ElementContext, AnySourceConfig, McpSourceConfig } from '@anyapp/core'
import {
  DEFAULT_OLLAMA_BASE_URL,
  isOllamaReachable,
  listOllamaModels,
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
  resolve: (approved: boolean) => void
}>()

/** Current permission mode. */
let currentPermissionMode: PermissionMode = 'default'

/**
 * The live Pi agent session, rebuilt whenever the active app or session changes.
 * Pi owns the transcript, so there is no separate in-memory history to keep.
 */
let agentHost: AgentHost | null = null

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
 * The last report built from a live session.
 *
 * `disposeAgentHost` runs on an app switch, a session switch, and every skills, sources
 * or config save. Without this the meter would drop back to the fixed floor several
 * times a minute during ordinary use and look broken. Holding the last answer lets it
 * say `as of last turn` instead of forgetting the conversation exists.
 */
let cachedReport: ContextReport | null = null

/**
 * Drop the remembered conversation.
 *
 * Called only where the conversation itself changes — an app switch, a cleared chat, a
 * different session. A skills or sources save also disposes the host, but the
 * conversation it was holding is still the one on screen, and forgetting it there is
 * what would make the meter look broken.
 */
function forgetCachedReport(): void {
  cachedReport = null
}

/**
 * Whether a turn is in flight.
 *
 * Only `agent:compact` reads it. Compacting mid-run would summarize a conversation Pi
 * is still appending to.
 */
let agentRunActive = false

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
const configDir = join(homedir(), '.anyapp')

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

/** App runner instance for dev servers. */
const appRunner = new AppRunner()

/** Chat history manager instance. */
const chatHistoryManager = new ChatHistoryManager(piAgentDir)

/** Currently active app ID for agent context. */
let activeAppId: string | null = null

/** Currently active session ID for the active app. */
let activeSessionId: string | null = null

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

/** The load counts for the open chat, or an empty map when there is no chat. */
function currentSkillLoads(): Map<string, number> {
  return skillLoadsByChat.get(activeSessionId ?? '') ?? new Map()
}

/**
 * Record a skill the agent has just loaded.
 *
 * Keyed by chat rather than reset on every switch: the counts are then simply correct
 * when the user comes back to an earlier chat, and there is no list of assignment sites
 * that has to stay in step with a reset call.
 *
 * @param chunk - A streamed chunk on its way to the renderer
 * @returns True when a count changed and the panel should be told
 */
function recordSkillLoad(chunk: StreamChunk): boolean {
  if (chunk.type !== 'tool_start' || chunk.tool !== 'load_skill') return false

  const name = chunk.input?.name
  if (typeof name !== 'string' || name.length === 0) return false

  const chatId = activeSessionId ?? ''
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
 */
async function onTurnComplete(mainWindow: BrowserWindow): Promise<void> {
  const appId = activeAppId
  const sessionId = activeSessionId
  if (!appId) return

  // The agent can write a skill into the app's `skills/` directory during a turn, and
  // the panel would otherwise not show it until the user pressed reload. A turn boundary
  // is a cheap and sufficient trigger — a skill library is a handful of small files, and
  // it is the only moment a skill can appear without the renderer already knowing. A
  // filesystem watcher would also catch a hand edit in Finder, which the reload button
  // covers, at the price of two watchers whose lifetime tracks the active app.
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('skills:changed')
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
  mainWindow.webContents.send('chat:session-changed', sessionId)
  mainWindow.webContents.send('chat:history-loaded', { sessionId, messages })
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
  try {
    const sessions = await chatHistoryManager.listSessions(appId)
    if (mainWindow.isDestroyed()) return null
    mainWindow.webContents.send('sessions:list-updated', sessions)
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
 * anyapp runs on a local Ollama daemon and no longer holds any secret, so this file
 * is deleted on startup rather than read.
 */
const legacyApiKeyPath = join(configDir, '.apikey')

/**
 * Persisted application configuration, stored at `~/.anyapp/config.json`.
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
   * what the daemon serves; anyapp probes `/api/ps` for the real number and falls
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
   * Modelfile — 0.7 to 1.0 on the qwen builds anyapp targets. Most of a coding turn
   * is reproducing text that already exists, so anyapp pins 0; null restores the
   * model's default for anyone who wants it.
   */
  samplingTemperature: number | null
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
  samplingTemperature: DEFAULT_SAMPLING_TEMPERATURE
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
 * @returns Absolute path to `~/.anyapp/pi`
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
async function loadSkillLibrary(): Promise<SkillLibrary> {
  const app = await getActiveApp()

  const library = await buildSkillLibrary({
    appSkillsDir: app ? getAppSkillsDir(app.path) : null,
    workspaceSkillsDir,
    disabledSkills: app?.disabledSkills
  })

  const loads = currentSkillLoads()
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
async function loaderForScope(scope: SkillScope): Promise<SkillsLoader> {
  if (scope === 'workspace') return workspaceSkills

  const app = await getActiveApp()
  if (!app) {
    throw new Error("Open an app before changing that app's skills")
  }
  return new SkillsLoader(getAppSkillsDir(app.path), 'app')
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
  action: 'write' | 'delete'
): Promise<string | undefined> {
  if (scope !== 'app') return undefined

  const app = await getActiveApp()
  if (!app) return undefined

  const relativePath = `skills/${name}/SKILL.md`
  const outcome = await autoCommitSkillChange({
    rootPath: app.path,
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
async function withSkillDirectives(text: string): Promise<string> {
  const mentions = extractSkillMentions(text)
  if (mentions.length === 0) return text

  const available = activeSkills(await loadSkillLibrary())
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
 * `~/.anyapp/skills` was read by the agent and by the Skills panel and written by
 * neither, so on any install where the `docs/skills/` copies had not been placed by hand
 * the agent ran with none. `working-notes` is the one that matters: the post-compaction
 * nudge in `agent/session.ts` tells the model to read `NOTES.md`, and that skill is
 * where the convention for keeping one is defined.
 *
 * A skill the user has edited is never overwritten, but one anyapp shipped with content
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
 * command anyapp will spawn and, once connected, becomes part of the agent's tool
 * surface. Everything is checked here rather than in `SourceManager`.
 *
 * @param config - The raw value from the renderer
 * @returns A validated MCP source configuration
 * @throws {Error} If any field is missing, mistyped, or out of bounds
 */
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
  return activeAppId
}

/**
 * Get the currently active app.
 */
export async function getActiveApp(): Promise<SubApp | null> {
  if (!activeAppId) return null
  return appManager.getApp(activeAppId)
}

/**
 * Resolve a renderer-supplied app path to a real sub-app root.
 *
 * The renderer is untrusted, and `rootPath` is the value every path check is performed
 * *against* — `isWithinRoot` only ever means "inside whatever string the caller called
 * the root". So a handler that takes `appPath` on faith is not confined at all: a
 * compromised renderer could ask for `~/.ssh/id_rsa` with `appPath` set to the home
 * directory and the confinement would agree that the file is inside the root.
 *
 * Every path here has to come from `AppManager`, which is the only authority on where
 * sub-apps actually live.
 *
 * @param appPath - The path the renderer supplied, if any
 * @returns The verified sub-app root
 * @throws {Error} If no app is selected, or the path is not a known sub-app
 */
async function resolveAppRoot(appPath?: string): Promise<string> {
  if (appPath === undefined) {
    const active = await getActiveApp()
    if (!active) throw new Error('No app selected')
    return active.path
  }

  if (typeof appPath !== 'string' || appPath.length === 0 || appPath.length > 4096) {
    throw new Error('Invalid app path')
  }

  const known = await appManager.listApps()
  const match = known.find((app) => app.path === appPath)
  if (!match) throw new Error('Unknown app path')
  return match.path
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
function denyPendingApprovals(): void {
  for (const [id, pending] of pendingApprovals) {
    pendingApprovals.delete(id)
    pending.resolve(false)
  }
}

/**
 * Tear down the live agent session, if any.
 */
async function disposeAgentHost(): Promise<void> {
  if (!agentHost) return
  const host = agentHost
  agentHost = null
  try {
    await host.abort()
  } catch {
    // Aborting an idle session is not an error.
  }
  host.dispose()
  denyPendingApprovals()
}

/**
 * Get the agent session for the active app, creating it on first use.
 *
 * @param mainWindow - The window that receives streamed chunks and approval prompts
 * @returns A live agent host bound to the active app
 * @throws {Error} If no app is selected or no model is configured
 */
async function ensureAgentHost(mainWindow: BrowserWindow): Promise<AgentHost> {
  const app = await getActiveApp()
  if (!app) {
    throw new Error('No app selected. Choose or create an app before chatting.')
  }

  const config = getConfig()
  if (!config.ollamaModel) {
    throw new Error('No model selected. Pick an Ollama model in Settings.')
  }

  if (agentHost && agentHost.appId === app.id) {
    return agentHost
  }

  await disposeAgentHost()

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
    mainWindow.webContents.send('agent:stream', chunk)
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
    activeSessionId = created.id
    sessionFile = await chatHistoryManager.getActiveSessionPath(app.id)
  }

  agentHost = await createAgentHost({
    app,
    agentDir: piAgentDir,
    modelId: config.ollamaModel,
    budget,
    toolProfile: config.toolProfile,
    trimContext: config.trimContext,
    samplingTemperature: config.samplingTemperature,
    sessionFile: sessionFile ?? undefined,
    mcpSources: sourceManager.getConnectedSources().filter((source) => source.connected),
    callbacks: {
      getPermissionMode: () => currentPermissionMode,
      denyPendingApprovals,
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
        mainWindow.webContents.send('agent:tool-approval', request)

        // Deliberately unbounded. A turn on a local model can take minutes, so
        // stepping away while one runs is normal — and a timeout here does not fail
        // safe, it silently *denies* a call the user meant to allow, with no way to
        // tell that apart from a refusal. The prompt is settled by an answer, by
        // aborting the run, or by the session being torn down.
        return new Promise((resolve) => {
          pendingApprovals.set(id, { resolve })
        })
      },

      onStream: (chunk: StreamChunk): void => {
        if (mainWindow.isDestroyed()) return
        mainWindow.webContents.send('agent:stream', chunk)

        if (recordSkillLoad(chunk)) {
          mainWindow.webContents.send('skills:changed')
        }

        // A finished turn is the only moment the session list is known to have
        // changed — a new message moves `updatedAt`, and the first one gives an
        // untitled chat a name. Deliberately after the turn, never during it: a
        // concurrent generate contends with the model the turn just loaded.
        if (chunk.type === 'complete') {
          void onTurnComplete(mainWindow)
        }
      }
    }
  })

  return agentHost
}

/**
 * Set up all IPC handlers for the main window.
 * @param mainWindow - The main BrowserWindow instance
 */
export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // Get current permission mode
  ipcMain.handle('permissions:get-mode', (): PermissionMode => {
    return currentPermissionMode
  })

  // Set permission mode
  ipcMain.handle('permissions:set-mode', (_, mode: PermissionMode): PermissionMode => {
    if (!['plan', 'default', 'acceptEdits', 'bypassPermissions'].includes(mode)) {
      throw new Error(`Invalid permission mode: ${mode}`)
    }
    currentPermissionMode = mode
    return currentPermissionMode
  })

  // Start a fresh agent session, discarding the current transcript
  ipcMain.handle('agent:clear-history', async (): Promise<void> => {
    await disposeAgentHost()
    forgetCachedReport()
  })

  // Send message to agent
  ipcMain.handle('agent:message', async (_, prompt: string | SerializedContentBlock[]): Promise<void> => {
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

    /**
     * Stream chunks to the renderer process.
     */
    const onStream = (chunk: StreamChunk): void => {
      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send('agent:stream', chunk)
    }

    try {
      const host = await ensureAgentHost(mainWindow)
      const { text, elements } = splitPrompt(prompt)

      if (text.length > MAX_PROMPT_CHARS) {
        throw new Error('Prompt too long')
      }

      agentRunActive = true
      try {
        await host.sendPrompt({ text: await withSkillDirectives(text), elements })
      } finally {
        agentRunActive = false
      }
    } catch (error) {
      const err = error as Error
      onStream({ type: 'error', error: err.message })
      onStream({ type: 'complete' })
    }
  })

  // Cancel the in-flight agent run
  ipcMain.handle('agent:abort', async (): Promise<void> => {
    // Order matters: deny first, so the `tool_call` handler awaiting approval
    // unblocks and Pi's loop can observe the abort. Aborting alone would not reach
    // it — see denyPendingApprovals.
    denyPendingApprovals()
    await agentHost?.abort()
  })

  // What the context window holds, attributed to blocks the user can act on
  ipcMain.handle('agent:get-context-report', async (): Promise<ContextReport | null> => {
    const app = await getActiveApp()
    if (!app) return null

    // Deliberately not `ensureAgentHost`. Building a host warms the model, and this
    // handler runs whenever the chat panel mounts — including on the panel switch the
    // user made precisely because they did not want to wait for the agent.
    //
    // The app id is checked too, not just the host's existence. Every site that changes
    // which app is active disposes the host first, so today this can only match or be
    // null — but that invariant is held by convention across ten call sites, and one
    // (`apps:delete`) already clears `activeAppId` without disposing. A report read off
    // a host bound to another app would answer with that app's conversation.
    if (agentHost && agentHost.appId === app.id) {
      const report = await agentHost.getContextReport()
      cachedReport = report
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
    if (!cachedReport) return floor

    const carried = cachedReport.blocks.filter((block) => block.group === 'conversation')
    if (carried.length === 0) return floor

    const blocks = [...floor.blocks, ...carried]

    return {
      ...floor,
      state: 'stale',
      measured: cachedReport.measured,
      estimated: blocks.reduce((sum, block) => sum + block.tokens, 0),
      blocks,
      hotspots: cachedReport.hotspots
    }
  })

  // Summarize the conversation now rather than at the threshold
  ipcMain.handle('agent:compact', async (): Promise<void> => {
    if (!agentHost) throw new Error('No conversation to compact yet.')
    if (agentRunActive) throw new Error('Wait for the current turn to finish.')
    await agentHost.compact()
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
  // Every one of these routes its `appPath` through `resolveAppRoot`. They took it on
  // faith for as long as they existed, which was dormant while nothing in the renderer
  // passed one — `getDiff` had no caller at all. The code panel and the commit diff are
  // the first real consumers, so the check is no longer theoretical.
  ipcMain.handle('version:get-state', async (_, appPath?: string) => {
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.getState()
  })

  ipcMain.handle('version:get-branches', async (_, appPath?: string) => {
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.listBranches()
  })

  ipcMain.handle('version:get-history', async (_, depth?: number, appPath?: string) => {
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.getHistory({ depth })
  })

  ipcMain.handle('version:switch-branch', async (_, name: string, appPath?: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.switchBranch(name)
  })

  ipcMain.handle('version:create-branch', async (_, name: string, appPath?: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.createBranch({ name })
  })

  ipcMain.handle('version:rollback', async (_, oid: string, appPath?: string) => {
    if (typeof oid !== 'string' || oid.length === 0) {
      throw new Error('Invalid commit OID')
    }
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.rollback(oid)
  })

  ipcMain.handle('version:diff', async (_, from: string, to: string, appPath?: string) => {
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new Error('Invalid commit OIDs')
    }
    const vm = new VersionManager(await resolveAppRoot(appPath))
    return vm.diff(from, to)
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
  ipcMain.handle('files:tree', async (_, appPath?: string) => {
    return listAppFiles(await resolveAppRoot(appPath))
  })

  ipcMain.handle('files:read', async (_, filePath: string, appPath?: string) => {
    // The renderer is untrusted. Length is bounded here as well as type, so a path built
    // by a runaway loop cannot be handed to the filesystem.
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new Error('Invalid file path')
    }
    return readAppFile({ rootPath: await resolveAppRoot(appPath), path: filePath })
  })

  /**
   * Compiler errors for one file, for the code viewer's squiggles.
   *
   * Deliberately the *same* service the agent's writes are checked against — borrowed
   * from the registry rather than started separately — so the human and the model are
   * never shown two different accounts of whether the code compiles.
   */
  ipcMain.handle('files:diagnostics', async (_, filePath: string, appPath?: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new Error('Invalid file path')
    }

    const lease = acquireTsService(await resolveAppRoot(appPath))
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

    // Clear active if deleting active app
    if (activeAppId === id) {
      activeAppId = null
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

  ipcMain.handle('apps:set-active', async (_, id: string | null) => {
    // `activeAppId` becomes the root every path check is performed *against*, so this
    // is the same class of input as `resolveAppRoot`'s `appPath` and gets the same
    // treatment: not "is it a non-empty string", but "is it an app that exists".
    // `AppManager` refuses a traversing id on its own now; this is what turns that
    // refusal into an error the user sees rather than an app that silently will not open.
    if (id !== null) {
      if (typeof id !== 'string' || !isValidAppId(id)) {
        throw new Error('Invalid app ID')
      }
      if (!(await appManager.getApp(id))) {
        throw new Error('Unknown app ID')
      }
    }
    
    // Switching app discards the agent session; the next message builds a new one.
    await disposeAgentHost()
    // Only when the app actually changes. Re-selecting the open app is an ordinary
    // navigation — the Apps page is how a user gets back to a chat — and forgetting the
    // conversation there would drop the context meter to its fixed floor for a trip the
    // user made to return to the very conversation it describes.
    if (id !== activeAppId) forgetCachedReport()
    activeAppId = id
    activeSessionId = null
    
    if (id) {
      // Load manifest (triggers migration if needed)
      const manifest = await chatHistoryManager.loadManifest(id)

      // Auto-create the first session if none exist. It is deliberately created
      // with no title, so its name is derived from the first message rather than
      // frozen at 'Chat' forever.
      if (manifest.sessions.length === 0) {
        const session = await chatHistoryManager.createSession(id)
        activeSessionId = session.id
        sendSessionChanged(mainWindow, activeAppId, session.id, [])
      } else {
        activeSessionId = manifest.activeSessionId

        const history = activeSessionId
          ? await chatHistoryManager.loadHistory(id, activeSessionId)
          : []
        sendSessionChanged(mainWindow, activeAppId, activeSessionId, history)
      }

      await broadcastSessions(mainWindow, id)
    }
    
    return activeAppId
  })

  ipcMain.handle('apps:get-active', async () => {
    return activeAppId
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
    await disposeAgentHost()
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
    await disposeAgentHost()
    return connected
  })

  ipcMain.handle('sources:disconnect', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    await sourceManager.disconnect(id)
    await disposeAgentHost()
  })

  ipcMain.handle('sources:delete', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    await sourceManager.deleteSource(id)
    await disposeAgentHost()
  })

  // Skills IPC handlers
  ipcMain.handle('skills:list', async (): Promise<SkillLibrary> => {
    return loadSkillLibrary()
  })

  ipcMain.handle('skills:save', async (_, request: unknown): Promise<SkillLibraryUpdate> => {
    const { scope, draft } = parseSkillWrite(request)
    await (await loaderForScope(scope)).save(draft)
    const warning = await commitAppSkill(scope, draft.name, 'write')
    await disposeAgentHost()
    return { library: await loadSkillLibrary(), warning }
  })

  ipcMain.handle('skills:delete', async (_, request: unknown): Promise<SkillLibraryUpdate> => {
    const { scope, name } = parseSkillRef(request)
    await (await loaderForScope(scope)).delete(name)
    const warning = await commitAppSkill(scope, name, 'delete')
    await disposeAgentHost()
    return { library: await loadSkillLibrary(), warning }
  })

  ipcMain.handle('skills:set-enabled', async (_, request: unknown): Promise<SkillLibrary> => {
    if (typeof request !== 'object' || request === null) {
      throw new Error('Invalid request')
    }
    const { name, enabled } = request as { name?: unknown; enabled?: unknown }
    if (!isValidSkillName(name) || typeof enabled !== 'boolean') {
      throw new Error('Invalid skill name or state')
    }

    const app = await getActiveApp()
    if (!app) {
      throw new Error('Open an app before turning a skill on or off')
    }

    const disabled = new Set(app.disabledSkills ?? [])
    if (enabled) disabled.delete(name)
    else disabled.add(name)

    await appManager.updateApp(app.id, { disabledSkills: [...disabled].sort() })
    await disposeAgentHost()
    return loadSkillLibrary()
  })

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
    // Bounded by what the OpenAI-compatible endpoint accepts. Null is the deliberate
    // "leave the model alone" value and is not the same as 0.
    if (
      config.samplingTemperature !== null &&
      (typeof config.samplingTemperature !== 'number' ||
        !Number.isFinite(config.samplingTemperature) ||
        config.samplingTemperature < MIN_SAMPLING_TEMPERATURE ||
        config.samplingTemperature > MAX_SAMPLING_TEMPERATURE)
    ) {
      throw new Error('Invalid sampling temperature')
    }
    return saveConfig(config)
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
  ipcMain.handle('chat:load-history', async (): Promise<ChatHistoryPayload> => {
    if (!activeAppId || !activeSessionId) return { sessionId: null, messages: [] }
    return {
      sessionId: activeSessionId,
      messages: await chatHistoryManager.loadHistory(activeAppId, activeSessionId)
    }
  })

  ipcMain.handle('chat:clear-history', async () => {
    if (!activeAppId || !activeSessionId) {
      throw new Error('No active session')
    }
    await chatHistoryManager.clearHistory(activeAppId, activeSessionId)
    await disposeAgentHost()
    forgetCachedReport()
  })

  // Chat session IPC handlers
  ipcMain.handle('sessions:list', async () => {
    if (!activeAppId) return []
    return chatHistoryManager.listSessions(activeAppId)
  })

  ipcMain.handle('sessions:create', async (_, params?: CreateChatSessionParams) => {
    if (!activeAppId) throw new Error('No active app')

    const session = await chatHistoryManager.createSession(activeAppId, params)

    // Switch to the new session
    activeSessionId = session.id
    await disposeAgentHost()
    forgetCachedReport()

    // Notify renderer
    sendSessionChanged(mainWindow, activeAppId, session.id, [])
    await broadcastSessions(mainWindow, activeAppId)

    return session
  })

  ipcMain.handle('sessions:delete', async (_, sessionId: string) => {
    if (!activeAppId) throw new Error('No active app')
    assertSessionId(sessionId)

    await chatHistoryManager.deleteSession(activeAppId, sessionId)
    forgetSkillLoads([sessionId])

    // If we deleted the active session, load the new active
    if (activeSessionId === sessionId) {
      const newActiveId = await chatHistoryManager.getActiveSessionId(activeAppId)
      activeSessionId = newActiveId
      await disposeAgentHost()
      forgetCachedReport()

      const history = newActiveId
        ? await chatHistoryManager.loadHistory(activeAppId, newActiveId)
        : []
      sendSessionChanged(mainWindow, activeAppId, newActiveId, history)
    }

    await broadcastSessions(mainWindow, activeAppId)
  })

  ipcMain.handle('sessions:rename', async (_, sessionId: string, title: string) => {
    if (!activeAppId) throw new Error('No active app')
    assertSessionId(sessionId)
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error('Invalid title')
    }
    const renamed = await chatHistoryManager.renameSession(activeAppId, sessionId, title)
    await broadcastSessions(mainWindow, activeAppId)
    return renamed
  })

  ipcMain.handle('sessions:set-active', async (_, sessionId: string) => {
    if (!activeAppId) throw new Error('No active app')
    assertSessionId(sessionId)

    await chatHistoryManager.setActiveSession(activeAppId, sessionId)
    activeSessionId = sessionId
    await disposeAgentHost()
    forgetCachedReport()

    // Load history for the new session
    const history = await chatHistoryManager.loadHistory(activeAppId, sessionId)
    sendSessionChanged(mainWindow, activeAppId, sessionId, history)
  })

  ipcMain.handle('sessions:get-active', async () => {
    return activeSessionId
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

    const app = await appManager.getApp(id)
    if (!app) {
      throw new Error(`App "${id}" not found`)
    }

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
    // Notify all renderer windows to inject element context
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('chat:element-context-added', context)
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
  ipcMain.removeHandler('agent:abort')
  ipcMain.removeHandler('agent:get-context-report')
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

  // Tear down the agent session
  void disposeAgentHost()

  // Reset active app and session
  activeAppId = null
  activeSessionId = null

  // Disconnect all sources
  sourceManager.disconnectAll().catch(() => {})
  
  // Deny, not reject: a rejection throws inside the `tool_call` handler that is
  // awaiting it, which risks an unhandled rejection during teardown. Closing the
  // window is a denial like any other.
  denyPendingApprovals()
}
