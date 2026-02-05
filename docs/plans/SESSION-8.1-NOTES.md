# Session 8.1 Notes: Types and AppRunner

## Status

**Complete**

## Completed

- [x] Task 1: Add type definitions to `packages/core/src/apps.ts`
- [x] Task 2: Create `AppRunner` class in `packages/shared/src/apps/runner.ts`
- [x] Task 3: Update exports in `packages/shared/src/apps/index.ts`
- [x] Task 4: Update exports in `packages/shared/src/index.ts`
- [x] `bun run typecheck:all` passes

## Files Created

| File | Purpose |
|------|---------|
| `packages/shared/src/apps/runner.ts` | AppRunner class for managing dev server processes |

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/apps.ts` | Added RunningApp, AppLogEntry, AppStatusChange, PortConfig, AppRunConfig types |
| `packages/shared/src/apps/index.ts` | Added AppRunner export |
| `packages/shared/src/index.ts` | Added AppRunner export |

## New Types

### RunningApp
State of a running app:
- `appId`: App ID that is running
- `pid`: Process ID
- `url`: URL where app is accessible (null for CLI apps)
- `port`: Port the app is running on
- `startedAt`: ISO timestamp

### AppLogEntry
Log entry from a running app:
- `appId`: App ID that produced the log
- `timestamp`: ISO timestamp
- `type`: 'stdout' | 'stderr' | 'system'
- `message`: Log message content

### AppStatusChange
Status change event:
- `appId`: App ID
- `status`: 'starting' | 'running' | 'stopped' | 'error'
- `url`: URL if running
- `port`: Port if running
- `error`: Error message if status is 'error'

### PortConfig
Port range configuration:
- `base`: Starting port number
- `max`: Maximum port number

### AppRunConfig
Run configuration per template:
- `command`: Command to run (e.g., 'bun')
- `args`: Base arguments
- `ports`: PortConfig
- `portFlag`: How to pass port (CLI flag or env var name)
- `readyPattern`: Regex to detect when server is ready

## AppRunner Class

### Port Ranges by Template

| Template | Port Range | Port Method |
|----------|------------|-------------|
| react-vite | 5200-5299 | `--port` flag |
| node-server | 3100-3199 | `PORT` env var |
| static-site | 3200-3299 | `-l` flag (serve) |
| node-cli | N/A | No server |
| blank | N/A | Not runnable |

### Methods

- `start(appId, appPath, template)` - Start dev server, returns RunningApp
- `stop(appId)` - Gracefully stop (SIGTERM, then SIGKILL after 5s)
- `stopAll()` - Stop all running apps
- `isRunning(appId)` - Check if app is running
- `getRunning()` - Get all running apps as Map
- `getRunningApp(appId)` - Get specific running app
- `isRunnable(template)` - Check if template supports running

### Events

- `log` - Emits AppLogEntry for stdout/stderr/system messages
- `status` - Emits AppStatusChange for starting/running/stopped/error

### Security Features

Blocked environment variables when spawning processes:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `AWS_SECRET_ACCESS_KEY`
- `GITHUB_TOKEN`
- `NPM_TOKEN`

## Implementation Notes

- Used Node.js built-in modules only (no new npm dependencies)
- `node:child_process` for spawn
- `node:net` for port availability checking
- `node:events` for EventEmitter base class
- Needed to run `bun run build` in core package before typecheck would pass (compiled types required)

## Issues Encountered

- Initial typecheck failed because shared package looks at compiled `.d.ts` files from core
- Fixed by running `bun run build` in `packages/core` first

## Next Steps

Proceed to **SESSION-8.2-IPC-AND-PRELOAD.md** to add IPC handlers for running apps from the renderer process.
