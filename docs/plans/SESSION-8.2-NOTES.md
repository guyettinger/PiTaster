# Session 8.2 Notes: IPC Handlers and Preload API

## Status

**Complete**

## Completed

- [x] Task 1: Add `ansi-to-html` and `tree-kill` dependencies
- [x] Task 2: Add AppRunner instance and IPC handlers to `ipc.ts`
- [x] Task 3: Update `cleanupIpcHandlers()` with cleanup logic
- [x] Task 4: Add interfaces and API methods to `preload/index.ts`
- [x] Task 5: Add types to `electron.d.ts`
- [x] `bun run typecheck:all` passes

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/package.json` | Added `ansi-to-html@^0.7.2` and `tree-kill@^1.2.2` dependencies |
| `apps/electron/src/main/ipc.ts` | Added AppRunner instance, 7 new IPC handlers, event forwarding, cleanup |
| `apps/electron/src/preload/index.ts` | Added 3 interfaces and 12 new API methods |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Added 3 interfaces, extended ElectronAPI, updated exports |

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ansi-to-html` | ^0.7.2 | Terminal color rendering (for Session 8.3) |
| `tree-kill` | ^1.2.2 | Process tree cleanup |

## New IPC Handlers

| Channel | Description |
|---------|-------------|
| `apps:run` | Start dev server for an app via AppRunner.start() |
| `apps:stop` | Stop running app via AppRunner.stop() |
| `apps:get-running` | Get all running apps (Map converted to array) |
| `apps:is-running` | Check if specific app is running |
| `apps:get-running-info` | Get RunningApp info for specific app |
| `apps:open-browser` | Open running app URL in external browser |
| `apps:install-deps` | Run `bun install` in app directory with log streaming |

## Event Channels (Main → Renderer)

| Channel | Description |
|---------|-------------|
| `apps:log` | Log entries from running apps (AppLogEntry) |
| `apps:status-change` | Status changes for running apps (AppStatusChange) |

## New Preload API Methods

### App Runner Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `runApp(id)` | `Promise<RunningApp>` | Start dev server |
| `stopApp(id)` | `Promise<void>` | Stop running app |
| `getRunningApps()` | `Promise<RunningApp[]>` | Get all running apps |
| `isAppRunning(id)` | `Promise<boolean>` | Check if app is running |
| `getRunningAppInfo(id)` | `Promise<RunningApp \| null>` | Get running app info |
| `openInBrowser(id)` | `Promise<void>` | Open in external browser |
| `installDeps(id)` | `Promise<void>` | Run bun install |

### Event Listeners

| Method | Description |
|--------|-------------|
| `onAppLog(callback)` | Subscribe to log events |
| `offAppLog()` | Unsubscribe from log events |
| `onAppStatusChange(callback)` | Subscribe to status changes |
| `offAppStatusChange()` | Unsubscribe from status changes |

## New Types (in electron.d.ts)

### RunningApp
```typescript
interface RunningApp {
  appId: string
  pid: number
  url: string | null
  port: number
  startedAt: string
}
```

### AppLogEntry
```typescript
interface AppLogEntry {
  appId: string
  timestamp: string
  type: 'stdout' | 'stderr' | 'system'
  message: string
}
```

### AppStatusChange
```typescript
interface AppStatusChange {
  appId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  url?: string
  port?: number
  error?: string
}
```

## Implementation Notes

- Added `shell` import from Electron for `openExternal()` functionality
- Event forwarding setup happens inside `setupIpcHandlers()` to access `mainWindow`
- `apps:get-running` converts Map to array for IPC serialization
- `apps:install-deps` spawns `bun install` and streams output via `apps:log` channel
- Cleanup includes `appRunner.stopAll()` to terminate any running processes on window close

## Issues Encountered

- Initial typecheck failed with "Module has no exported member 'AppRunner'"
- Fixed by running `bun run build` in both `packages/core` and `packages/shared` to generate compiled `.d.ts` files
- The electron package uses compiled types from workspace packages, not source files directly

## Next Steps

Proceed to **SESSION-8.3-CONTEXT-AND-TERMINAL.md** to add running apps context and terminal panel UI.
