# Session 6.4 Notes: IPC Integration

## Completed

- [x] App management IPC handlers registered in main process
- [x] Active app ID state tracking with `activeAppId`
- [x] Exported `getActiveAppId()` and `getActiveApp()` for agent scoping
- [x] Preload exposes all app management methods
- [x] Version control handlers accept optional `appPath` parameter
- [x] TypeScript declarations updated with new methods
- [x] `bun run typecheck:all` passes

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/main/ipc.ts` | Added AppManager import, activeAppId state, 8 app handlers, updated version handlers for appPath |
| `apps/electron/src/preload/index.ts` | Added SubApp/CreateAppParams types, 8 app methods, updated version methods for appPath |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Added `updateApp`, `setActiveApp`, `getActiveApp`, `getActiveAppDetails`; updated version method signatures |

## IPC Handlers Added

```typescript
// App management handlers
apps:list          -> appManager.listApps()
apps:get           -> appManager.getApp(id)
apps:create        -> appManager.createApp(params)
apps:delete        -> appManager.deleteApp(id) + clear activeAppId if deleting active
apps:update        -> appManager.updateApp(id, updates)
apps:set-active    -> set activeAppId
apps:get-active    -> return activeAppId
apps:get-active-details -> return full SubApp for activeAppId
```

## Version Control Updates

All version handlers now accept optional `appPath` parameter:
- Falls back to `(await getActiveApp())?.path` when not provided
- Throws `Error('No app selected')` if no path available
- Creates new `VersionManager(path)` per call for flexibility

## Preload API Added

```typescript
// App management
listApps: () => Promise<SubApp[]>
getApp: (id: string) => Promise<SubApp | null>
createApp: (params: CreateAppParams) => Promise<SubApp>
deleteApp: (id: string) => Promise<void>
updateApp: (id: string, updates) => Promise<SubApp>
setActiveApp: (id: string | null) => Promise<string | null>
getActiveApp: () => Promise<string | null>
getActiveAppDetails: () => Promise<SubApp | null>
```

## Exported Functions for Session 6.5

```typescript
// From ipc.ts - for agent scoping
export function getActiveAppId(): string | null
export async function getActiveApp(): Promise<SubApp | null>
```

## Test Commands

```typescript
// In renderer DevTools console:
await window.electronAPI.listApps()
const app = await window.electronAPI.createApp({ name: 'Test', template: 'blank' })
await window.electronAPI.setActiveApp(app.id)
await window.electronAPI.getActiveAppDetails()
await window.electronAPI.deleteApp(app.id)
```

## Notes

- AppManager instance is shared across all handlers
- Active app state is cleared when deleting the active app
- Version handlers create new VersionManager per call (not cached) to support multiple apps
- Cleanup function resets `activeAppId` to null

## Next

Proceed to **SESSION-6.5-AGENT-SCOPING.md** to scope agent operations to active app.
