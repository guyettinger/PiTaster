# Session 6: Sub-Apps (Sandboxed Self-Modification)

## Overview

This session introduces the **sub-apps architecture** where the outer Electron container remains immutable while inner sub-apps are fully self-modifiable. Each sub-app is an isolated project with its own git versioning.

**Estimated scope**: Large (broken into 6 sub-sessions)  
**Prerequisites**: Session 5 complete  
**Deliverable**: App management system with sandboxed, self-modifiable sub-apps

## Architecture

### Before (Sessions 1-5)
```
PiTaster/
├── apps/electron/          # Self-modifying (unsafe)
├── packages/core/          # Self-modifying (unsafe)
└── packages/shared/        # Self-modifying (unsafe)
```

### After (Session 6)
```
PiTaster/
├── apps/electron/          # IMMUTABLE - outer container
├── packages/core/          # IMMUTABLE - core types
├── packages/shared/        # IMMUTABLE - shared logic
└── ~/.pitaster/
    └── apps/               # Sub-apps directory
        ├── my-todo-app/    # Sandboxed sub-app
        │   ├── .git/       # Per-app versioning
        │   └── src/
        └── my-weather-app/ # Another sub-app
            ├── .git/
            └── src/
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Immutable Container** | Electron app cannot be modified by the agent |
| **Sandboxed Sub-Apps** | Each app in `~/.pitaster/apps/` is self-contained |
| **Per-App Versioning** | Independent git repos for branching/rollback |
| **Scoped Context** | Agent only sees/modifies the active app |
| **App Templates** | Pre-defined scaffolds for common app types |

## Sub-Sessions

| Sub-Session | Focus | Scope |
|-------------|-------|-------|
| [6.1: Types + Manager](SESSION-6.1-TYPES-AND-MANAGER.md) | Core types and AppManager base | Small |
| [6.2: App Templates](SESSION-6.2-APP-TEMPLATES.md) | Template configs and createApp | Small |
| [6.3: App Listing UI](SESSION-6.3-APP-LISTING-UI.md) | React components for app management | Small |
| [6.4: IPC Integration](SESSION-6.4-IPC-INTEGRATION.md) | IPC handlers and preload API | Small |
| [6.5: Agent Scoping](SESSION-6.5-AGENT-SCOPING.md) | Scoped tools and security | Medium |
| [6.6: Integration](SESSION-6.6-INTEGRATION.md) | Wire everything together | Small |

## App Templates

| Template | Description |
|----------|-------------|
| `react-vite` | React 19 + Vite + Tailwind |
| `node-cli` | TypeScript CLI tool |
| `node-server` | Hono HTTP server |
| `static-site` | HTML/CSS/JS website |
| `blank` | Empty project |

## User Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Apps      │ ──→  │   Chat      │ ──→  │  Version    │
│   Panel     │      │ (scoped)    │      │  Control    │
└─────────────┘      └─────────────┘      └─────────────┘
     │                     │                    │
     ▼                     ▼                    ▼
 Create/Delete        Agent works          Branches,
 Select app           on active app        Rollback
```

## Security

1. **Path Sandboxing**: All file operations restricted to app directory
2. **Path Traversal Prevention**: `../` patterns stripped from paths
3. **Immutable Container**: Main Electron app cannot be modified
4. **Command Filtering**: Dangerous shell commands blocked
5. **Isolated Git**: Each app's history is independent

## Implementation Order

1. **6.1** - Define types, create AppManager skeleton
2. **6.2** - Add templates and createApp
3. **6.3** - Build UI components
4. **6.4** - Wire up IPC communication
5. **6.5** - Implement agent scoping
6. **6.6** - Integrate into main app

Each sub-session is designed to be completable in a single agent context window.

## Verification (End of Session 6)

- [ ] Can create apps from all 5 templates
- [ ] Can delete apps with confirmation
- [ ] Agent tools only access active app
- [ ] Path traversal attacks are blocked
- [ ] Git operations work per-app
- [ ] Version control UI shows app-specific data
- [ ] System prompt reflects active app context

## Final Commit

```bash
git add -A
git commit -m "feat: complete sub-apps architecture (Session 6)

- Immutable outer container, modifiable sub-apps
- 5 app templates: React, Node CLI, Server, Static, Blank
- Per-app git versioning in ~/.pitaster/apps/
- Agent tools scoped to active app
- Path traversal prevention
- App management UI"
```
