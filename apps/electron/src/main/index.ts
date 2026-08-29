import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupIpcHandlers, cleanupIpcHandlers, initializeConfig } from './ipc'
import { setProjectRoot } from './agent'

/** Directory of this module, for resolving bundled assets under ESM. */
const moduleDir = dirname(fileURLToPath(import.meta.url))

/** Reference to the main window for cleanup. */
let mainWindow: BrowserWindow | null = null

/**
 * Creates the main application window.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    },
    titleBarStyle: 'hiddenInset',
    show: false
  })

  // Setup IPC handlers for agent communication
  setupIpcHandlers(mainWindow)

  // Set default project root to the app's location
  // In development, this will be the project directory
  // In production, this should be set by the user
  if (process.env.NODE_ENV === 'development') {
    // Go up from out/main to the project root
    setProjectRoot(join(moduleDir, '../../..'))
  }

  // Clean up IPC handlers when window is closed
  mainWindow.on('closed', () => {
    cleanupIpcHandlers()
    mainWindow = null
  })

  // Show window when ready to prevent visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    // In development, load from Vite dev server
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl)
    }
  } else {
    // In production, load from built files
    mainWindow.loadFile(join(moduleDir, '../renderer/index.html'))
  }
}

// Handle app lifecycle
app.whenReady().then(async () => {
  // Load persisted settings before the first message. Earlier versions only reached
  // loadConfig() from the config:get handler, so a fresh launch never saw them.
  await initializeConfig()

  createWindow()

  // macOS: Re-create window when dock icon clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
