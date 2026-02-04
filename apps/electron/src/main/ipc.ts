/**
 * IPC handlers for agent communication between main and renderer processes.
 */

import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import { nanoid } from 'nanoid'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { runAgentQuery, setProjectRoot, getProjectRoot } from './agent'
import { VersionManager, SourceManager, SkillsLoader } from '@anyapp/shared'
import type { PermissionMode, StreamChunk, MessageParam } from './agent'
import type { Skill } from '@anyapp/core'

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
      // Run the agent query and update conversation history
      conversationHistory = await runAgentQuery({
        prompt,
        permissionMode: currentPermissionMode,
        requestApproval,
        onStream,
        conversationHistory
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
  ipcMain.handle('version:get-state', async () => {
    const vm = getVersionManager()
    return vm.getState()
  })

  ipcMain.handle('version:get-branches', async () => {
    const vm = getVersionManager()
    return vm.listBranches()
  })

  ipcMain.handle('version:get-history', async (_, depth?: number) => {
    const vm = getVersionManager()
    return vm.getHistory({ depth })
  })

  ipcMain.handle('version:switch-branch', async (_, name: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const vm = getVersionManager()
    return vm.switchBranch(name)
  })

  ipcMain.handle('version:create-branch', async (_, name: string) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Invalid branch name')
    }
    const vm = getVersionManager()
    return vm.createBranch({ name })
  })

  ipcMain.handle('version:rollback', async (_, oid: string) => {
    if (typeof oid !== 'string' || oid.length === 0) {
      throw new Error('Invalid commit OID')
    }
    const vm = getVersionManager()
    return vm.rollback(oid)
  })

  ipcMain.handle('version:diff', async (_, from: string, to: string) => {
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new Error('Invalid commit OIDs')
    }
    const vm = getVersionManager()
    return vm.diff(from, to)
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
  
  // Reset version manager
  versionManager = null

  // Disconnect all sources
  sourceManager.disconnectAll().catch(() => {})
  
  // Reject any pending approvals
  for (const [id, pending] of pendingApprovals) {
    pending.reject(new Error('Window closed'))
    pendingApprovals.delete(id)
  }
}
