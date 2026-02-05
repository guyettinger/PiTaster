# Session 8.3 Notes: Running Apps Context and Terminal Panel

## Status

**Complete**

## Completed

- [x] Task 1: Create `RunningAppsContext.tsx` with state management
- [x] Task 2: Create `TerminalPanel.tsx` with ANSI color support
- [x] Task 3: Add `RunningAppsProvider` wrapper to `App.tsx`
- [x] `bun run typecheck:all` passes

## Files Created

| File | Description |
|------|-------------|
| `apps/electron/src/renderer/src/context/RunningAppsContext.tsx` | React context for running apps state management |
| `apps/electron/src/renderer/src/components/TerminalPanel.tsx` | Terminal panel component with ANSI color parsing |

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/renderer/src/App.tsx` | Added `RunningAppsProvider` import and wrapper |

## RunningAppsContext Features

### State

| State | Type | Description |
|-------|------|-------------|
| `runningApps` | `Map<string, RunningApp>` | Currently running apps by ID |
| `appStatuses` | `Map<string, AppStatus>` | App status by ID (starting/running/stopped/error) |
| `logs` | `Map<string, AppLogEntry[]>` | Log entries per app (max 1000 per app) |

### Actions

| Method | Description |
|--------|-------------|
| `startApp(id)` | Start an app's dev server |
| `stopApp(id)` | Stop a running app |
| `clearLogs(id)` | Clear logs for an app |
| `installDeps(id)` | Install dependencies for an app |
| `openInBrowser(id)` | Open running app in external browser |

### Helpers

| Method | Return Type | Description |
|--------|-------------|-------------|
| `isRunning(id)` | `boolean` | Check if app is running or starting |
| `getStatus(id)` | `AppStatus \| null` | Get current status for an app |
| `getUrl(id)` | `string \| null` | Get URL for a running app |
| `getLogs(id)` | `AppLogEntry[]` | Get logs for an app |

### IPC Integration

- On mount: Loads initial running apps via `getRunningApps()`
- Subscribes to `onAppLog()` for log streaming
- Subscribes to `onAppStatusChange()` for status updates
- Cleanup: Unsubscribes via `offAppLog()` and `offAppStatusChange()`

## TerminalPanel Features

### ANSI Color Support

Maps ANSI codes to Tailwind classes:

| ANSI Code | Color | Tailwind Class |
|-----------|-------|----------------|
| 30 | Black | `text-neutral-900` |
| 31 | Red | `text-red-500` |
| 32 | Green | `text-green-500` |
| 33 | Yellow | `text-yellow-500` |
| 34 | Blue | `text-blue-500` |
| 35 | Purple | `text-purple-500` |
| 36 | Cyan | `text-cyan-500` |
| 37 | White | `text-neutral-200` |
| 90-97 | Bright variants | `text-*-400` / `text-white` |

### Toolbar Controls

| Control | Description |
|---------|-------------|
| Status indicator | Shows current app status with color coding |
| Filter dropdown | Filter logs by type (all/stdout/stderr/system) |
| Timestamps toggle | Show/hide timestamps on log entries |
| Auto-scroll toggle | Enable/disable auto-scroll to bottom |
| Clear button | Clear all logs for the current app |

### Props

```typescript
interface TerminalPanelProps {
  appId: string      // App ID to show logs for
  isVisible: boolean // Whether the panel is visible
}
```

## Implementation Notes

- Used `useMemo` for filtered logs to avoid recomputing on every render
- Auto-scroll detection: Considers user at bottom if within 50px of scroll height
- Log limit: Maximum 1000 entries per app to prevent memory issues
- ANSI parsing uses regex to extract color codes and apply appropriate Tailwind classes
- Reset code (0) and default color code (39) clear the current color class

## Next Steps

Proceed to **SESSION-8.4-PREVIEW-PANEL.md** to add the embedded webview preview component.
