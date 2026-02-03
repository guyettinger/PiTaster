import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { setupIpcHandlers, cleanupIpcHandlers } from './ipc'
import { setProjectRoot } from './agent'

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
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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
    setProjectRoot(join(__dirname, '../../..'))
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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Handle app lifecycle
app.whenReady().then(() => {
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
