# Session 6.4: IPC Integration

## Overview

This sub-session adds the IPC handlers, preload API, and TypeScript declarations for app management.

**Estimated scope**: Small  
**Prerequisites**: Session 6.3 complete  
**Deliverable**: Working IPC communication for app operations

## Objectives

1. Add IPC handlers in main process
2. Expose API in preload script
3. Update TypeScript declarations

---

## Task 1: IPC Handlers

### Update apps/electron/src/main/ipc.ts

Add app management handlers:

```typescript
import { ipcMain } from 'electron'
import { AppManager } from '@pitaster/shared'
import type { CreateAppParams } from '@pitaster/core'

const appManager = new AppManager()

// Track active app for agent context
let activeAppId: string | null = null

/**
 * Get the currently active app ID.
 */
export function getActiveAppId(): string | null {
  return activeAppId
}

/**
 * Get the currently active app.
 */
export async function getActiveApp() {
  if (!activeAppId) return null
  return appManager.getApp(activeAppId)
}

/**
 * Register app management IPC handlers.
 */
export function registerAppHandlers(): void {
  // List all apps
  ipcMain.handle('apps:list', async () => {
    return appManager.listApps()
  })

  // Get single app
  ipcMain.handle('apps:get', async (_, id: string) => {
    return appManager.getApp(id)
  })

  // Create new app
  ipcMain.handle('apps:create', async (_, params: CreateAppParams) => {
    return appManager.createApp(params)
  })

  // Delete app
  ipcMain.handle('apps:delete', async (_, id: string) => {
    // Clear active if deleting active app
    if (activeAppId === id) {
      activeAppId = null
    }
    return appManager.deleteApp(id)
  })

  // Update app metadata
  ipcMain.handle('apps:update', async (_, id: string, updates: { name?: string; description?: string }) => {
    return appManager.updateApp(id, updates)
  })

  // Set active app (for agent context)
  ipcMain.handle('apps:set-active', async (_, id: string | null) => {
    activeAppId = id
    return activeAppId
  })

  // Get active app ID
  ipcMain.handle('apps:get-active', async () => {
    return activeAppId
  })

  // Get active app details
  ipcMain.handle('apps:get-active-details', async () => {
    return getActiveApp()
  })
}
```

### Update apps/electron/src/main/index.ts

Register the handlers on app start:

```typescript
import { registerAppHandlers } from './ipc'

// In the app initialization:
app.whenReady().then(() => {
  // ... existing setup ...
  
  registerAppHandlers()
  
  // ... rest of setup ...
})
```

---

## Task 2: Preload API

### Update apps/electron/src/preload/index.ts

Add app management API:

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { SubApp, CreateAppParams } from '@pitaster/core'

contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing API methods ...

  // App management
  listApps: (): Promise<SubApp[]> => 
    ipcRenderer.invoke('apps:list'),
  
  getApp: (id: string): Promise<SubApp | null> => 
    ipcRenderer.invoke('apps:get', id),
  
  createApp: (params: CreateAppParams): Promise<SubApp> => 
    ipcRenderer.invoke('apps:create', params),
  
  deleteApp: (id: string): Promise<void> => 
    ipcRenderer.invoke('apps:delete', id),
  
  updateApp: (id: string, updates: { name?: string; description?: string }): Promise<SubApp> => 
    ipcRenderer.invoke('apps:update', id, updates),
  
  setActiveApp: (id: string | null): Promise<string | null> => 
    ipcRenderer.invoke('apps:set-active', id),
  
  getActiveApp: (): Promise<string | null> => 
    ipcRenderer.invoke('apps:get-active'),
  
  getActiveAppDetails: (): Promise<SubApp | null> => 
    ipcRenderer.invoke('apps:get-active-details'),
})
```

---

## Task 3: TypeScript Declarations

### Update apps/electron/src/renderer/src/types/electron.d.ts

Add type definitions:

```typescript
import type { 
  SubApp, 
  CreateAppParams, 
  PermissionMode,
  StreamChunk,
  ToolApprovalRequest 
} from '@pitaster/core'

interface ElectronAPI {
  // Agent communication
  sendMessage: (message: string) => Promise<void>
  onAgentStream: (callback: (chunk: StreamChunk) => void) => void
  
  // Permissions
  getPermissionMode: () => Promise<PermissionMode>
  setPermissionMode: (mode: PermissionMode) => Promise<PermissionMode>
  
  // Tool approval
  onToolApproval: (callback: (request: ToolApprovalRequest) => void) => void
  respondToolApproval: (response: { id: string; approved: boolean }) => void
  
  // Version control
  getVersionState: (appPath?: string) => Promise<VersionState>
  getBranches: (appPath?: string) => Promise<Branch[]>
  getHistory: (appPath?: string, depth?: number) => Promise<Commit[]>
  switchBranch: (name: string, appPath?: string) => Promise<void>
  createBranch: (name: string, appPath?: string) => Promise<void>
  rollback: (oid: string, appPath?: string) => Promise<void>
  getDiff: (from: string, to: string, appPath?: string) => Promise<FileDiff[]>
  
  // App management
  listApps: () => Promise<SubApp[]>
  getApp: (id: string) => Promise<SubApp | null>
  createApp: (params: CreateAppParams) => Promise<SubApp>
  deleteApp: (id: string) => Promise<void>
  updateApp: (id: string, updates: { name?: string; description?: string }) => Promise<SubApp>
  setActiveApp: (id: string | null) => Promise<string | null>
  getActiveApp: () => Promise<string | null>
  getActiveAppDetails: () => Promise<SubApp | null>
  
  // Config
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<void>
  
  // Skills
  listSkills: () => Promise<Skill[]>
  loadSkill: (name: string) => Promise<Skill | null>
  
  // Sources
  listSources: () => Promise<Source[]>
  connectSource: (id: string) => Promise<void>
  disconnectSource: (id: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
```

---

## Task 4: Update Version Control IPC for App Path

### Update apps/electron/src/main/ipc.ts

Make version control handlers app-aware:

```typescript
import { VersionManager } from '@pitaster/shared'

// Update version control handlers to accept optional appPath
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

ipcMain.handle('version:get-history', async (_, appPath?: string, depth?: number) => {
  const path = appPath ?? (await getActiveApp())?.path
  if (!path) throw new Error('No app selected')
  const vm = new VersionManager(path)
  return vm.getHistory({ depth })
})

ipcMain.handle('version:switch-branch', async (_, name: string, appPath?: string) => {
  const path = appPath ?? (await getActiveApp())?.path
  if (!path) throw new Error('No app selected')
  const vm = new VersionManager(path)
  return vm.switchBranch(name)
})

ipcMain.handle('version:create-branch', async (_, name: string, appPath?: string) => {
  const path = appPath ?? (await getActiveApp())?.path
  if (!path) throw new Error('No app selected')
  const vm = new VersionManager(path)
  return vm.createBranch({ name })
})

ipcMain.handle('version:rollback', async (_, oid: string, appPath?: string) => {
  const path = appPath ?? (await getActiveApp())?.path
  if (!path) throw new Error('No app selected')
  const vm = new VersionManager(path)
  return vm.rollback(oid)
})

ipcMain.handle('version:diff', async (_, from: string, to: string, appPath?: string) => {
  const path = appPath ?? (await getActiveApp())?.path
  if (!path) throw new Error('No app selected')
  const vm = new VersionManager(path)
  return vm.diff(from, to)
})
```

---

## Verification Checklist

- [ ] App IPC handlers registered in main process
- [ ] Preload exposes all app management methods
- [ ] TypeScript declarations updated
- [ ] Version control handlers accept optional appPath
- [ ] Active app state tracked correctly
- [ ] `bun run typecheck:all` passes

## Test Commands

```typescript
// In renderer DevTools console:

// List apps
await window.electronAPI.listApps()

// Create app
const app = await window.electronAPI.createApp({
  name: 'Test',
  template: 'blank'
})

// Set active
await window.electronAPI.setActiveApp(app.id)

// Get active
await window.electronAPI.getActiveAppDetails()

// Delete
await window.electronAPI.deleteApp(app.id)
```

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.4): add IPC handlers for app management

- Register app CRUD handlers in main process
- Expose app API in preload script
- Update TypeScript declarations
- Make version control handlers app-path aware
- Track active app state in main process"
```

---

## Next

Proceed to **SESSION-6.5-AGENT-SCOPING.md** to scope agent operations to active app.
