# Session 8.2: IPC Handlers and Preload API

## Overview

This sub-session adds the IPC handlers in the main process and preload API methods for the renderer to communicate with AppRunner.

**Estimated scope**: Small  
**Prerequisites**: Session 8.1 complete  
**Deliverable**: IPC handlers and preload API for app running

## Objectives

1. Add IPC handlers for run/stop/status
2. Add preload API methods
3. Update type definitions

---

## Task 1: Add Dependencies

### Update apps/electron/package.json

Add these dependencies:

```json
{
  "dependencies": {
    "ansi-to-html": "^0.7.2",
    "tree-kill": "^1.2.2"
  }
}
```

Run `bun install` in the electron app directory.

---

## Task 2: IPC Handlers

### Update apps/electron/src/main/ipc.ts

Add imports at the top:

```typescript
import { shell } from 'electron'
import { AppRunner } from '@anyapp/shared'
import type { AppLogEntry, AppStatusChange, RunningApp } from '@anyapp/core'
```

Add the AppRunner instance after the other manager instances:

```typescript
/** App runner instance for dev servers. */
const appRunner = new AppRunner()
```

Add these handlers inside `setupIpcHandlers()`:

```typescript
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
```

Update `cleanupIpcHandlers()` to add cleanup for the new handlers:

```typescript
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
```

---

## Task 3: Preload API

### Update apps/electron/src/preload/index.ts

Add new types near the top:

```typescript
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
```

Add these methods to the `electronAPI` object:

```typescript
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
   * Install dependencies for an app.
   * @param id - The app ID
   */
  installDeps: (id: string): Promise<void> => {
    return ipcRenderer.invoke('apps:install-deps', id)
  },

  /**
   * Listen for app log events.
   * @param callback - Function called with each log entry
   */
  onAppLog: (callback: (entry: AppLogEntry) => void): void => {
    ipcRenderer.on('apps:log', (_event, entry) => callback(entry))
  },

  /**
   * Remove app log listener.
   */
  offAppLog: (): void => {
    ipcRenderer.removeAllListeners('apps:log')
  },

  /**
   * Listen for app status changes.
   * @param callback - Function called with status changes
   */
  onAppStatusChange: (callback: (change: AppStatusChange) => void): void => {
    ipcRenderer.on('apps:status-change', (_event, change) => callback(change))
  },

  /**
   * Remove app status change listener.
   */
  offAppStatusChange: (): void => {
    ipcRenderer.removeAllListeners('apps:status-change')
  },
```

---

## Task 4: Update Type Definitions

### Update apps/electron/src/renderer/src/types/electron.d.ts

Add the new types:

```typescript
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

/** Status change event. */
interface AppStatusChange {
  appId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  url?: string
  port?: number
  error?: string
}
```

Add methods to `ElectronAPI` interface:

```typescript
  // App runner methods
  /** Run a sub-app's dev server. */
  runApp: (id: string) => Promise<RunningApp>
  /** Stop a running app. */
  stopApp: (id: string) => Promise<void>
  /** Get all running apps. */
  getRunningApps: () => Promise<RunningApp[]>
  /** Check if an app is running. */
  isAppRunning: (id: string) => Promise<boolean>
  /** Get running info for an app. */
  getRunningAppInfo: (id: string) => Promise<RunningApp | null>
  /** Open a running app in browser. */
  openInBrowser: (id: string) => Promise<void>
  /** Install dependencies for an app. */
  installDeps: (id: string) => Promise<void>
  /** Listen for app log events. */
  onAppLog: (callback: (entry: AppLogEntry) => void) => void
  /** Remove app log listener. */
  offAppLog: () => void
  /** Listen for app status changes. */
  onAppStatusChange: (callback: (change: AppStatusChange) => void) => void
  /** Remove app status change listener. */
  offAppStatusChange: () => void
```

Add to the exports at the bottom:

```typescript
export type {
  // ... existing exports
  RunningApp,
  AppLogEntry,
  AppStatusChange
}
```

---

## Verification Checklist

- [ ] Dependencies added to `apps/electron/package.json`
- [ ] `bun install` run successfully
- [ ] IPC handlers added to `ipc.ts`
- [ ] Cleanup handlers updated
- [ ] Preload API methods added
- [ ] Type definitions updated
- [ ] `bun run typecheck:all` passes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(8.2): add IPC handlers and preload API for app runner

- Add apps:run, apps:stop, apps:get-running IPC handlers
- Add apps:open-browser and apps:install-deps handlers
- Add log and status change event streaming
- Add preload API methods for renderer
- Update type definitions"
```

---

## Next

Proceed to **SESSION-8.3-CONTEXT-AND-TERMINAL.md** to add state management and terminal panel.
