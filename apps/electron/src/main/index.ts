import { app, BrowserWindow, nativeImage } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { dockIconSvg } from '@anyapp/shared'
import { setupIpcHandlers, cleanupIpcHandlers, initializeConfig, initializeSources } from './ipc'

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
    // Centres the traffic lights in the renderer's 44px shell header, which is
    // the only draggable chrome the window has.
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#121316',
    show: false
  })

  // Setup IPC handlers for agent communication
  setupIpcHandlers(mainWindow)

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

/**
 * Rasterises the anyapp mark and installs it as the macOS dock icon.
 *
 * There is no packaging config and no `resources/` directory in this repo, so
 * the icon is rendered from the shared SVG at startup rather than read from
 * disk. Failure is non-fatal: a missing dock icon must never stop the window
 * from opening.
 */
async function setDockIcon(): Promise<void> {
  if (process.platform !== 'darwin' || !app.dock) return

  try {
    const png = await sharp(Buffer.from(dockIconSvg({ size: 1024 })))
      .png()
      .toBuffer()
    const image = nativeImage.createFromBuffer(png)
    if (!image.isEmpty()) {
      app.dock.setIcon(image)
    }
  } catch (error) {
    console.error('Failed to render the dock icon:', error)
  }
}

// Handle app lifecycle
app.setName('anyapp')

app.whenReady().then(async () => {
  // Load persisted settings before the first message. Earlier versions only reached
  // loadConfig() from the config:get handler, so a fresh launch never saw them.
  await initializeConfig()

  // Connect enabled MCP sources in the background. Spawning a server can be slow
  // (an `npx` fetch, say), and none of it needs to block the first paint — the
  // agent session is built on the first prompt, by which time these have settled.
  void initializeSources()

  // The dock icon is cosmetic, so it renders alongside the first paint rather
  // than delaying it.
  void setDockIcon()

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
