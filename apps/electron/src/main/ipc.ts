/**
 * IPC handlers for agent communication between main and renderer processes.
 */

import { ipcMain, BrowserWindow, safeStorage, shell } from 'electron'
import { nanoid } from 'nanoid'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { runAgentQuery, setProjectRoot, getProjectRoot } from './agent'
import { VersionManager, SourceManager, SkillsLoader, AppManager, AppRunner, ChatHistoryManager } from '@anyapp/shared'
import type { PermissionMode, StreamChunk, MessageParam } from './agent'
import type { Skill, CreateAppParams, SubApp, AppLogEntry, AppStatusChange, RunningApp, PersistedMessage, SerializedTextBlock } from '@anyapp/core'

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

/** Conversation history for session continuity. */
let conversationHistory: MessageParam[] = []

/** Default timeout for tool approval (60 seconds). */
const APPROVAL_TIMEOUT_MS = 60000

/** Version manager instance - initialized lazily. */
let versionManager: VersionManager | null = null

/** Config directory for sources and skills. */
const configDir = join(homedir(), '.anyapp')

/** Source manager instance. */
const sourceManager = new SourceManager(configDir)

/** Skills loader instance. */
const skillsLoader = new SkillsLoader(join(configDir, 'skills'))

/** App manager instance. */
const appManager = new AppManager()

/** App runner instance for dev servers. */
const appRunner = new AppRunner()

/** Chat history manager instance. */
const chatHistoryManager = new ChatHistoryManager()

/** Currently active app ID for agent context. */
let activeAppId: string | null = null

/** Path to config file. */
const configPath = join(configDir, 'config.json')

/** Path to encrypted API key file. */
const apiKeyPath = join(configDir, '.apikey')

/** Application configuration interface. */
interface AppConfig {
  anthropicApiKey?: string
  theme: 'light' | 'dark' | 'system'
  autoCommit: boolean
}

/** Default configuration. */
const defaultConfig: AppConfig = {
  theme: 'dark',
  autoCommit: true
}

/**
 * Load the application configuration.
 */
async function loadConfig(): Promise<AppConfig> {
  try {
    // Ensure config directory exists
    await fs.mkdir(configDir, { recursive: true })
    
    // Load main config
    let config = { ...defaultConfig }
    try {
      const data = await fs.readFile(configPath, 'utf-8')
      config = { ...defaultConfig, ...JSON.parse(data) }
    } catch {
      // Config doesn't exist yet, use defaults
    }
    
    // Load encrypted API key if it exists
    try {
      const encryptedKey = await fs.readFile(apiKeyPath)
      if (safeStorage.isEncryptionAvailable()) {
        config.anthropicApiKey = safeStorage.decryptString(encryptedKey)
      }
    } catch {
      // API key doesn't exist
    }
    
    return config
  } catch (error) {
    console.error('Failed to load config:', error)
    return defaultConfig
  }
}

/**
 * Save the application configuration.
 */
async function saveConfig(config: AppConfig): Promise<void> {
  // Ensure config directory exists
  await fs.mkdir(configDir, { recursive: true })
  
  // Extract API key to store separately
  const { anthropicApiKey, ...restConfig } = config
  
  // Save main config (without API key)
  await fs.writeFile(configPath, JSON.stringify(restConfig, null, 2))
  
  // Save API key encrypted if provided
  if (anthropicApiKey && safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(anthropicApiKey)
    await fs.writeFile(apiKeyPath, encrypted)
    
    // Also set environment variable for the current process
    process.env.ANTHROPIC_API_KEY = anthropicApiKey
  }
}

/**
 * Get or create the version manager instance.
 */
function getVersionManager(): VersionManager {
  if (!versionManager) {
    versionManager = new VersionManager(getProjectRoot())
  }
  return versionManager
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

  // Set project root directory
  ipcMain.handle('project:set-root', (_, path: string): void => {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('Invalid project path')
    }
    setProjectRoot(path)
  })

  // Clear conversation history
  ipcMain.handle('agent:clear-history', (): void => {
    conversationHistory = []
  })

  // Send message to agent
  ipcMain.handle('agent:message', async (_, prompt: string): Promise<void> => {
    // Validate input
    if (typeof prompt !== 'string' || prompt.length === 0) {
      throw new Error('Invalid prompt')
    }
    if (prompt.length > 100000) {
      throw new Error('Prompt too long')
    }

    /**
     * Request approval from the renderer process for a tool execution.
     */
    const requestApproval = async (tool: string, input: unknown): Promise<boolean> => {
      const id = nanoid()
      const request: ToolApprovalRequest = { 
        id, 
        tool, 
        input: input as Record<string, unknown> 
      }

      // Send to renderer for user approval
      mainWindow.webContents.send('agent:tool-approval', request)

      // Wait for response with timeout
      return new Promise((resolve, reject) => {
        pendingApprovals.set(id, { resolve, reject })

        // Timeout after 60 seconds - default to deny
        setTimeout(() => {
          if (pendingApprovals.has(id)) {
            pendingApprovals.delete(id)
            resolve(false)
          }
        }, APPROVAL_TIMEOUT_MS)
      })
    }

    /**
     * Stream chunks to the renderer process.
     */
    const onStream = (chunk: StreamChunk): void => {
      mainWindow.webContents.send('agent:stream', chunk)
    }

    try {
      // Get the currently active app for scoped operations
      const activeApp = await getActiveApp()
      
      // Run the agent query and update conversation history
      conversationHistory = await runAgentQuery({
        prompt,
        permissionMode: currentPermissionMode,
        requestApproval,
        onStream,
        conversationHistory,
        activeApp
      })
    } catch (error) {
      const err = error as Error
      onStream({ type: 'error', error: err.message })
    }
  })

  // Handle tool approval response from renderer
  ipcMain.on('agent:tool-response', (_, response: ToolApprovalResponse): void => {
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
    
    // Clear in-memory conversation history
    conversationHistory = []
    
    activeAppId = id
    
    if (id) {
      // Load persisted history for the new app
      const history = await chatHistoryManager.loadHistory(id)
      
      // Rebuild conversationHistory for Claude SDK from text content only
      for (const msg of history) {
        const textContent = msg.blocks
          .filter((b): b is SerializedTextBlock => b.type === 'text')
          .map((b) => b.content)
          .join('')
        
        if (textContent) {
          conversationHistory.push({
            role: msg.role,
            content: textContent
          })
        }
      }
      
      // Emit to renderer
      mainWindow.webContents.send('chat:history-loaded', history)
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
    return saveConfig(config)
  })

  // Chat history IPC handlers
  ipcMain.handle('chat:load-history', async () => {
    if (!activeAppId) {
      return []
    }
    return chatHistoryManager.loadHistory(activeAppId)
  })

  ipcMain.handle('chat:save-message', async (_, message: PersistedMessage) => {
    if (!activeAppId) {
      throw new Error('No active app')
    }
    if (!message || typeof message.id !== 'string') {
      throw new Error('Invalid message')
    }
    await chatHistoryManager.saveMessage(activeAppId, message)
  })

  ipcMain.handle('chat:clear-history', async () => {
    if (!activeAppId) {
      throw new Error('No active app')
    }
    await chatHistoryManager.clearHistory(activeAppId)
    conversationHistory = []
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
}

/**
 * Clean up IPC handlers when the window is destroyed.
 */
export function cleanupIpcHandlers(): void {
  ipcMain.removeHandler('permissions:get-mode')
  ipcMain.removeHandler('permissions:set-mode')
  ipcMain.removeHandler('project:set-root')
  ipcMain.removeHandler('agent:clear-history')
  ipcMain.removeHandler('agent:message')
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
  ipcMain.removeHandler('chat:save-message')
  ipcMain.removeHandler('chat:clear-history')
  
  // Reset version manager
  versionManager = null

  // Reset active app
  activeAppId = null

  // Disconnect all sources
  sourceManager.disconnectAll().catch(() => {})
  
  // Reject any pending approvals
  for (const [id, pending] of pendingApprovals) {
    pending.reject(new Error('Window closed'))
    pendingApprovals.delete(id)
  }
}
