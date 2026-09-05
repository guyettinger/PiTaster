# Session 6.5 Notes: Agent Scoping

## Completed

- [x] Added `normalizePath()` function for path traversal prevention
- [x] Added `BLOCKED_COMMANDS` constant for shell command safety
- [x] Implemented `createScopedTools()` factory with 12 scoped tools
- [x] Added `TEMPLATE_HINTS` with file structure hints per template
- [x] Implemented `getSystemPrompt()` for dynamic context-aware prompts
- [x] Updated `RunAgentQueryParams` to accept optional `activeApp` parameter
- [x] Updated `runAgentQuery()` to use scoped tools and dynamic prompts
- [x] Updated `checkPermission()` to handle new tool names
- [x] Updated IPC handler to pass `activeApp` to `runAgentQuery()`
- [x] `bun run typecheck:all` passes

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/main/agent.ts` | Added normalizePath, BLOCKED_COMMANDS, AUTHOR, createScopedTools, TEMPLATE_HINTS, getSystemPrompt; updated runAgentQuery and checkPermission |
| `apps/electron/src/main/ipc.ts` | Updated agent:message handler to pass activeApp to runAgentQuery |

## Security Features

### Path Traversal Prevention

```typescript
function normalizePath(rootPath: string, relativePath: string): string | null {
  const cleaned = relativePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(segment => segment !== '..' && segment !== '.')
    .join('/')
  
  const fullPath = resolve(rootPath, cleaned)
  
  if (!fullPath.startsWith(rootPath)) {
    return null
  }
  
  return fullPath
}
```

### Blocked Commands

```typescript
const BLOCKED_COMMANDS = ['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']
```

## Scoped Tools

When an app is selected, these tools are available:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create/modify files (auto-commits) |
| `list_files` | List directory contents |
| `delete_file` | Remove files (commits deletion) |
| `create_branch` | Create new branch |
| `switch_branch` | Switch branches |
| `list_branches` | Show all branches |
| `get_history` | View commit history |
| `rollback` | Restore previous state |
| `git_status` | Check uncommitted changes |
| `run_command` | Run shell commands |

When no app is selected:

| Tool | Description |
|------|-------------|
| `no_app_selected` | Informational message guiding user to select an app |

## Dynamic System Prompt

The system prompt now adapts based on active app context:

- **No app selected**: Guides user to select or create an app
- **App selected**: Shows app name, template, branch, status, available tools, and template-specific file structure hints

## Template Hints

Each template includes specific guidance:

- `react-vite`: Entry point, component structure, Vite commands
- `node-cli`: CLI entry point, run/build commands
- `node-server`: Hono server structure, dev/start commands
- `static-site`: HTML/CSS/JS structure, local server command
- `blank`: Minimal guidance for custom projects

## Permission Updates

`checkPermission()` now handles:

- New scoped tools: `read_file`, `write_file`, `list_files`, `delete_file`, `create_branch`, `switch_branch`, `list_branches`, `get_history`, `rollback`, `git_status`
- Informational tool: `no_app_selected` (always allowed)
- Legacy tools preserved for backward compatibility

## Test Scenarios

```typescript
// These should all fail gracefully:
await read_file({ path: '../../../etc/passwd' })    // -> Error: Invalid path
await read_file({ path: '/etc/passwd' })            // -> Error: Invalid path
await write_file({ path: '../../outside.txt', ... }) // -> Error: Invalid path
await run_command({ command: 'rm -rf /' })          // -> Error: Command blocked
await run_command({ command: 'sudo apt install' })  // -> Error: Command blocked
```

## Notes

- All file operations are sandboxed to `~/.keylimepi/apps/<app-id>/`
- Git operations use isomorphic-git directly in scoped tools
- Each scoped tool has its own handler function (not a switch statement)
- VersionManager is instantiated per createScopedTools call for the active app
- Legacy selfModifyTools and executeTool remain for backward compatibility

## Next

Proceed to **SESSION-6.6-INTEGRATION.md** to wire everything together.
