/**
 * IPC handlers for agent communication between main and renderer processes.
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import { nanoid } from 'nanoid'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { createAgentHost, type AgentHost } from './agent/session'
import { VersionManager, SourceManager, SkillsLoader, AppManager, AppRunner, ChatHistoryManager } from '@anyapp/shared'
import type { PermissionMode, StreamChunk, Skill, CreateAppParams, SubApp, AppLogEntry, AppStatusChange, RunningApp, PersistedMessage, CreateChatSessionParams, SerializedContentBlock, ElementContext } from '@anyapp/core'
import {
  DEFAULT_OLLAMA_BASE_URL,
  isOllamaReachable,
  listOllamaModels,
  syncOllamaModels,
  type OllamaModel
} from './agent/ollama'
import { captureElement, type ElementInfo } from './screenshot'

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

/** Store for pending approval requests. */
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void
  reject: (error: Error) => void
}>()

/** Current permission mode. */
let currentPermissionMode: PermissionMode = 'default'

/**
 * The live Pi agent session, rebuilt whenever the active app or session changes.
 * Pi owns the transcript, so there is no separate in-memory history to keep.
 */
let agentHost: AgentHost | null = null

/** Default timeout for tool approval (60 seconds). */
const APPROVAL_TIMEOUT_MS = 60000

/** Maximum accepted prompt length, in characters. */
const MAX_PROMPT_CHARS = 100000

/** Maximum accepted number of content blocks in one prompt. */
const MAX_PROMPT_BLOCKS = 100

/** Config directory for sources and skills. */
const configDir = join(homedir(), '.anyapp')

/** Pi agent directory, holding models.json, settings.json and session transcripts. */
const piAgentDir = join(configDir, 'pi')


/** Source manager instance. */
const sourceManager = new SourceManager(configDir)

/** Skills loader instance. */
const skillsLoader = new SkillsLoader(join(configDir, 'skills'))

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

/** Path to config file. */
const configPath = join(configDir, 'config.json')

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
}

/** Default configuration. */
const defaultConfig: AppConfig = {
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
  ollamaModel: null,
  theme: 'dark',
  autoCommit: true
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
  await syncOllamaModels({ agentDir: piAgentDir, baseUrl: config.ollamaBaseUrl })
}

/**
 * Load configuration at startup and write Pi's model catalog.
 *
 * Earlier versions only reached {@link loadConfig} from the `config:get` handler, so a
 * fresh launch never saw the persisted settings.
 */
export async function initializeConfig(): Promise<void> {
  const config = await loadConfig()
  await syncOllamaModels({ agentDir: piAgentDir, baseUrl: config.ollamaBaseUrl })
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
    sessionFile: sessionFile ?? undefined,
    callbacks: {
      getPermissionMode: () => currentPermissionMode,
      getAutoCommit: () => getConfig().autoCommit,

      requestApproval: (tool: string, input: unknown): Promise<boolean> => {
        const id = nanoid()
        const request: ToolApprovalRequest = {
          id,
          tool,
          input: input as Record<string, unknown>
        }

        if (mainWindow.isDestroyed()) return Promise.resolve(false)
        mainWindow.webContents.send('agent:tool-approval', request)

        return new Promise((resolve, reject) => {
          pendingApprovals.set(id, { resolve, reject })

          // Deny by default if the user never answers.
          setTimeout(() => {
            if (pendingApprovals.has(id)) {
              pendingApprovals.delete(id)
              resolve(false)
            }
          }, APPROVAL_TIMEOUT_MS)
        })
      },

      onStream: (chunk: StreamChunk): void => {
        if (mainWindow.isDestroyed()) return
        mainWindow.webContents.send('agent:stream', chunk)
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

      await host.sendPrompt({ text, elements })
    } catch (error) {
      const err = error as Error
      onStream({ type: 'error', error: err.message })
      onStream({ type: 'complete' })
    }
  })

  // Cancel the in-flight agent run
  ipcMain.handle('agent:abort', async (): Promise<void> => {
    await agentHost?.abort()
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

  // Version control IPC handlers
  ipcMain.handle('version:get-state', async (_, appPath?: string) => {
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.getState()
  })

  ipcMain.handle('version:get-branches', async (_, appPath?: string) => {
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.listBranches()
  })

  ipcMain.handle('version:get-history', async (_, depth?: number, appPath?: string) => {
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.getHistory({ depth })
  })

  ipcMain.handle('version:switch-branch', async (_, name: string, appPath?: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.switchBranch(name)
  })

  ipcMain.handle('version:create-branch', async (_, name: string, appPath?: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.createBranch({ name })
  })

  ipcMain.handle('version:rollback', async (_, oid: string, appPath?: string) => {
    if (typeof oid !== 'string' || oid.length === 0) {
      throw new Error('Invalid commit OID')
    }
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.rollback(oid)
  })

  ipcMain.handle('version:diff', async (_, from: string, to: string, appPath?: string) => {
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new Error('Invalid commit OIDs')
    }
    const path = appPath ?? (await getActiveApp())?.path
    if (!path) throw new Error('No app selected')
    const vm = new VersionManager(path)
    return vm.diff(from, to)
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
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    // Clear active if deleting active app
    if (activeAppId === id) {
      activeAppId = null
    }
    return appManager.deleteApp(id)
  })

  ipcMain.handle('apps:update', async (_, id: string, updates: { name?: string; description?: string }) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid updates')
    }
    return appManager.updateApp(id, updates)
  })

  ipcMain.handle('apps:set-active', async (_, id: string | null) => {
    if (id !== null && (typeof id !== 'string' || id.length === 0)) {
      throw new Error('Invalid app ID')
    }
    
    // Switching app discards the agent session; the next message builds a new one.
    await disposeAgentHost()
    activeAppId = id
    activeSessionId = null
    
    if (id) {
      // Load manifest (triggers migration if needed)
      const manifest = await chatHistoryManager.loadManifest(id)
      
      // Auto-create first session if none exist
      if (manifest.sessions.length === 0) {
        const session = await chatHistoryManager.createSession(id, { title: 'Chat' })
        activeSessionId = session.id
        mainWindow.webContents.send('sessions:list-updated', [session])
        mainWindow.webContents.send('chat:session-changed', session.id)
        mainWindow.webContents.send('chat:history-loaded', [])
      } else {
        activeSessionId = manifest.activeSessionId
        
        if (activeSessionId) {
          const history = await chatHistoryManager.loadHistory(id, activeSessionId)
          mainWindow.webContents.send('chat:history-loaded', history)
        }
        
        // Send sessions list to renderer
        mainWindow.webContents.send('sessions:list-updated', manifest.sessions)
        mainWindow.webContents.send('chat:session-changed', activeSessionId)
      }
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

  ipcMain.handle('sources:save', async (_, config) => {
    if (!config || typeof config.id !== 'string') {
      throw new Error('Invalid source configuration')
    }
    return sourceManager.saveSource(config)
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
    return sourceManager.connect(config)
  })

  ipcMain.handle('sources:disconnect', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    return sourceManager.disconnect(id)
  })

  ipcMain.handle('sources:delete', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid source ID')
    }
    return sourceManager.deleteSource(id)
  })

  // Skills IPC handlers
  ipcMain.handle('skills:list', async () => {
    return skillsLoader.loadAll()
  })

  ipcMain.handle('skills:get', async (_, name: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid skill name')
    }
    return skillsLoader.load(name)
  })

  ipcMain.handle('skills:save', async (_, skill: Skill) => {
    if (!skill || typeof skill.name !== 'string') {
      throw new Error('Invalid skill')
    }
    return skillsLoader.save(skill)
  })

  ipcMain.handle('skills:delete', async (_, name: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid skill name')
    }
    return skillsLoader.delete(name)
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
    return saveConfig(config)
  })

  /**
   * List the models pulled into the local Ollama daemon, refreshing Pi's catalog.
   */
  ipcMain.handle('models:list', async (): Promise<OllamaModel[]> => {
    return syncOllamaModels({ agentDir: piAgentDir, baseUrl: getConfig().ollamaBaseUrl })
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
  ipcMain.handle('chat:load-history', async () => {
    if (!activeAppId || !activeSessionId) return []
    return chatHistoryManager.loadHistory(activeAppId, activeSessionId)
  })

  ipcMain.handle('chat:clear-history', async () => {
    if (!activeAppId || !activeSessionId) {
      throw new Error('No active session')
    }
    await chatHistoryManager.clearHistory(activeAppId, activeSessionId)
    await disposeAgentHost()
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

    // Notify renderer
    mainWindow.webContents.send('chat:history-loaded', [])
    mainWindow.webContents.send('chat:session-changed', session.id)

    return session
  })

  ipcMain.handle('sessions:delete', async (_, sessionId: string) => {
    if (!activeAppId) throw new Error('No active app')
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Invalid session ID')
    }

    await chatHistoryManager.deleteSession(activeAppId, sessionId)

    // If we deleted the active session, load the new active
    if (activeSessionId === sessionId) {
      const newActiveId = await chatHistoryManager.getActiveSessionId(activeAppId)
      activeSessionId = newActiveId
      await disposeAgentHost()

      if (newActiveId) {
        const history = await chatHistoryManager.loadHistory(activeAppId, newActiveId)
        mainWindow.webContents.send('chat:history-loaded', history)
      } else {
        mainWindow.webContents.send('chat:history-loaded', [])
      }
      mainWindow.webContents.send('chat:session-changed', newActiveId)
    }
  })

  ipcMain.handle('sessions:rename', async (_, sessionId: string, title: string) => {
    if (!activeAppId) throw new Error('No active app')
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Invalid session ID')
    }
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error('Invalid title')
    }
    return chatHistoryManager.renameSession(activeAppId, sessionId, title)
  })

  ipcMain.handle('sessions:set-active', async (_, sessionId: string) => {
    if (!activeAppId) throw new Error('No active app')
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Invalid session ID')
    }

    await chatHistoryManager.setActiveSession(activeAppId, sessionId)
    activeSessionId = sessionId
    await disposeAgentHost()

    // Load history for the new session
    const history = await chatHistoryManager.loadHistory(activeAppId, sessionId)
    mainWindow.webContents.send('chat:history-loaded', history)
    mainWindow.webContents.send('chat:session-changed', sessionId)
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

  ipcMain.handle('apps:install-deps', async (_, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid app ID')
    }

    const app = await appManager.getApp(id)
    if (!app) {
      throw new Error(`App "${id}" not found`)
    }

    // Run bun install in the app directory
    const { spawn } = await import('node:child_process')

    return new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', ['install'], {
        cwd: app.path,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      proc.stdout?.on('data', (data: Buffer) => {
        const entry: AppLogEntry = {
          appId: id,
          timestamp: new Date().toISOString(),
          type: 'stdout',
          message: data.toString()
        }
        mainWindow.webContents.send('apps:log', entry)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const entry: AppLogEntry = {
          appId: id,
          timestamp: new Date().toISOString(),
          type: 'stderr',
          message: data.toString()
        }
        mainWindow.webContents.send('apps:log', entry)
      })

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`bun install exited with code ${code}`))
        }
      })

      proc.on('error', reject)
    })
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
  ipcMain.removeHandler('skills:get')
  ipcMain.removeHandler('skills:save')
  ipcMain.removeHandler('skills:delete')

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
  
  // Reject any pending approvals
  for (const [id, pending] of pendingApprovals) {
    pending.reject(new Error('Window closed'))
    pendingApprovals.delete(id)
  }
}
