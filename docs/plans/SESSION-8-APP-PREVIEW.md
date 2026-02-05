# Session 8: App Preview System

## Overview

This session adds a complete **app preview system** allowing developers to run, view, and control sub-apps during development. Includes dev server management, embedded preview, external browser launch, integrated terminal, and status indicators.

**Estimated scope**: Large (broken into 6 sub-sessions)  
**Prerequisites**: Session 6 complete (Sub-Apps)  
**Deliverable**: Full app preview and dev server management system

## Architecture

### Before (Sessions 1-7)
```
Apps Panel → Chat Panel → Agent modifies files
                ↓
        (No way to run/preview the app)
```

### After (Session 8)
```
Apps Panel → Chat Panel → Agent modifies files
    ↓            ↓
 Run/Stop    Terminal Panel (logs)
    ↓            ↓
 Preview Panel (webview) ←→ Open in Browser
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **AppRunner** | Service managing dev server processes |
| **Port Management** | Auto-assigns ports to avoid conflicts |
| **Terminal Panel** | Shows dev server logs with ANSI colors |
| **Preview Panel** | Embedded webview to display running app |
| **Running Context** | React context tracking running apps |

## Port Configuration

To avoid conflicts with the host Electron app (Vite on 5173):

| Template | Port Range | How Port is Passed |
|----------|------------|-------------------|
| react-vite | 5200-5299 | `--port` CLI flag |
| node-server | 3100-3199 | `PORT` env var |
| static-site | 3200-3299 | `-l` CLI flag |
| node-cli | N/A | No server |
| blank | N/A | No server |

## Sub-Sessions

| Sub-Session | Focus | Scope |
|-------------|-------|-------|
| [8.1: Types + AppRunner](SESSION-8.1-TYPES-AND-RUNNER.md) | Core types and runner class | Small |
| [8.2: IPC + Preload](SESSION-8.2-IPC-AND-PRELOAD.md) | IPC handlers and preload API | Small |
| [8.3: Context + Terminal](SESSION-8.3-CONTEXT-AND-TERMINAL.md) | State management and terminal panel | Small |
| [8.4: Preview Panel](SESSION-8.4-PREVIEW-PANEL.md) | Webview preview component | Small |
| [8.5: App Controls](SESSION-8.5-APP-CONTROLS.md) | Run controls and status indicators | Small |
| [8.6: Layout Integration](SESSION-8.6-LAYOUT-INTEGRATION.md) | Wire everything into App.tsx | Small |

## Data Flow

```
User clicks "Run"
       ↓
electronAPI.runApp(id)
       ↓
IPC Handler → AppRunner.start(id)
       ↓
AppRunner finds available port
       ↓
Spawns: bun run dev --port 5200
       ↓
Streams stdout/stderr → IPC → onAppLog callback
       ↓
Detects "ready" pattern → IPC → onAppStatusChange
       ↓
UI shows green indicator + port
       ↓
Preview panel loads http://localhost:5200
```

## Dependencies

Add to `apps/electron/package.json`:

```json
{
  "dependencies": {
    "ansi-to-html": "^0.7.2",
    "tree-kill": "^1.2.2"
  }
}
```

## Security Considerations

1. **Environment Filtering**: Remove API keys when spawning processes
2. **Path Validation**: Verify app paths before spawning
3. **Process Cleanup**: Kill orphaned processes on app exit
4. **Webview Isolation**: Use partition for preview sessions

## Implementation Order

1. **8.1** - Define types, create AppRunner with port management
2. **8.2** - Add IPC handlers and preload API
3. **8.3** - Create running apps context and terminal panel
4. **8.4** - Build preview panel with webview
5. **8.5** - Add run controls to AppCard and AppHeader
6. **8.6** - Integrate bottom panel into main layout

Each sub-session is designed to be completable in a single agent context window.

## Verification (End of Session 8)

- [ ] Can run apps from all runnable templates
- [ ] Can stop running apps
- [ ] Port conflicts are avoided automatically
- [ ] Terminal shows colored log output
- [ ] Preview panel displays running web apps
- [ ] Can open app in external browser
- [ ] Status indicators show running state
- [ ] Multiple apps can run simultaneously
- [ ] Processes are cleaned up on app exit

## Final Commit

```bash
git add -A
git commit -m "feat: complete app preview system (Session 8)

- AppRunner manages dev server processes
- Dynamic port assignment (5200+ for Vite, 3100+ for servers)
- Terminal panel with ANSI color support
- Preview panel with embedded webview
- Run/stop controls in AppCard and AppHeader
- Open in browser functionality
- Running apps context for state management"
```
