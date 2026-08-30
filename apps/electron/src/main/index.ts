import { app, BrowserWindow, nativeImage } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { dockIconSvg } from '@anyapp/shared'
import { setupIpcHandlers, cleanupIpcHandlers, initializeConfig, initializeSources } from './ipc'
import { isSafeExternalUrl, openExternalUrl } from './external-links'

/** Directory of this module, for resolving bundled assets under ESM. */
const moduleDir = dirname(fileURLToPath(import.meta.url))

/** Reference to the main window for cleanup. */
let mainWindow: BrowserWindow | null = null

/** The packaged renderer entry, loaded in production builds. */
const rendererFile = join(moduleDir, '../renderer/index.html')

/**
 * Whether a URL is the renderer itself, and so may be navigated to.
 *
 * The dev server is matched by origin, not by exact URL, because Vite changes
 * path and query across HMR reloads. The production bundle is matched on its
 * exact path: `file:` as a whole is far too broad a grant, since it would let
 * a link navigate the window to any readable file on the machine and render
 * its contents.
 * @param url - The navigation target
 * @returns True when the target is the app's own renderer
 */
function isRendererUrl(url: string): boolean {
  try {
    const target = new URL(url)

    if (target.protocol === 'file:') {
      // Query and fragment must be empty too. The app loads the bundle with
      // neither, and `will-navigate` does not fire for in-page fragment
      // changes — so anything carrying one here is a full reload of the
      // renderer, which would silently discard the in-memory transcript.
      return (
        target.pathname === pathToFileURL(rendererFile).pathname &&
        target.search === '' &&
        target.hash === ''
      )
    }

    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    return devServerUrl !== undefined && target.origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

/**
 * Confines the main window to the renderer and routes outward links to the OS.
 *
 * The chat transcript renders model-authored markdown, so its links are
 * untrusted. Without these guards a single link could navigate the whole
 * window off the renderer — which would drop the app's UI and leave a remote
 * page sitting behind the context bridge. Nothing is allowed to replace the
 * renderer, and nothing is allowed to open a second window.
 * @param window - The window to confine
 */
function guardNavigation(window: BrowserWindow): void {
  // Anything that would spawn a window (target=_blank, window.open) is denied
  // outright; an http(s) target is handed to the user's browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void openExternalUrl(url).catch((error) => {
        console.error('Failed to open external URL:', error)
      })
    }
    return { action: 'deny' }
  })

  // Top-level navigation stays on the renderer. This is scoped to the window's
  // own webContents, so the `<webview>` in the preview panel — which exists to
  // navigate — is unaffected.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) {
      event.preventDefault()
      if (isSafeExternalUrl(url)) {
        void openExternalUrl(url).catch((error) => {
          console.error('Failed to open external URL:', error)
        })
      }
    }
  })
}

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

  guardNavigation(mainWindow)

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
    mainWindow.loadFile(rendererFile)
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
