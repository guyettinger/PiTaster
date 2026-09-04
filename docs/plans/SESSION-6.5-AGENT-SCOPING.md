# Session 6.5: Agent Scoping

## Overview

This sub-session scopes agent operations to the active sub-app, ensuring all file operations are sandboxed.

**Estimated scope**: Medium  
**Prerequisites**: Session 6.4 complete  
**Deliverable**: Agent tools scoped to active app with path traversal prevention

## Objectives

1. Scope agent file tools to active app directory
2. Prevent path traversal attacks
3. Update system prompt based on active app
4. Handle "no app selected" state

---

## Task 1: Scoped Agent Tools

### Update apps/electron/src/main/agent.ts

Replace or update the self-modification tools to be app-scoped:

```typescript
import { resolve, dirname } from 'node:path'
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { VersionManager } from '@pitaster/shared'
import { getActiveApp } from './ipc'

const AUTHOR = { name: 'Pi Taster Agent', email: 'agent@Pi Taster.local' }

/**
 * Normalize and validate a path to prevent directory traversal.
 * Returns null if the path would escape the root.
 */
function normalizePath(rootPath: string, relativePath: string): string | null {
  // Remove leading slashes and ../ patterns
  const cleaned = relativePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(segment => segment !== '..' && segment !== '.')
    .join('/')
  
  const fullPath = resolve(rootPath, cleaned)
  
  // Ensure the resolved path is still within root
  if (!fullPath.startsWith(rootPath)) {
    return null
  }
  
  return fullPath
}

/**
 * Create tools scoped to the active app.
 * Returns limited tools if no app is active.
 */
export async function createScopedTools() {
  const app = await getActiveApp()
  
  if (!app) {
    return [
      tool(
        'no_app_selected',
        'Display message when no app is selected',
        {},
        async () => ({
          content: [{
            type: 'text',
            text: 'No app is currently selected. Please select an app from the Apps panel to begin working.'
          }]
        })
      )
    ]
  }
  
  const rootPath = app.path
  const versionManager = new VersionManager(rootPath)
  
  return [
    // File reading
    tool(
      'read_file',
      'Read a file from the current app',
      {
        path: z.string().describe('Relative path within the app')
      },
      async ({ path }) => {
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid path - cannot access files outside the app' }]
          }
        }
        
        try {
          const content = await readFile(fullPath, 'utf-8')
          return { content: [{ type: 'text', text: content }] }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error reading file: ${message}` }] }
        }
      }
    ),
    
    // File writing (with auto-commit)
    tool(
      'write_file',
      'Write content to a file in the current app (auto-commits to git)',
      {
        path: z.string().describe('Relative path within the app'),
        content: z.string().describe('File content to write'),
        message: z.string().describe('Git commit message describing the change')
      },
      async ({ path, content, message }) => {
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid path - cannot write files outside the app' }]
          }
        }
        
        try {
          // Ensure directory exists
          await mkdir(dirname(fullPath), { recursive: true })
          
          // Write file
          await writeFile(fullPath, content)
          
          // Git add and commit
          const relativePath = fullPath.replace(rootPath + '/', '')
          await git.add({ fs, dir: rootPath, filepath: relativePath })
          
          const oid = await git.commit({
            fs,
            dir: rootPath,
            message,
            author: AUTHOR
          })
          
          return {
            content: [{
              type: 'text',
              text: `Wrote ${relativePath} (committed: ${oid.slice(0, 7)})`
            }]
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error writing file: ${message}` }] }
        }
      }
    ),
    
    // List files
    tool(
      'list_files',
      'List files in a directory of the current app',
      {
        path: z.string().optional().describe('Relative path (default: root)')
      },
      async ({ path = '.' }) => {
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid path' }]
          }
        }
        
        try {
          const entries = await readdir(fullPath, { withFileTypes: true })
          const files = entries
            .filter(e => e.name !== '.git' && e.name !== 'node_modules' && !e.name.startsWith('.Pi Taster'))
            .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
            .join('\n')
          
          return {
            content: [{ type: 'text', text: files || '(empty directory)' }]
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error listing files: ${message}` }] }
        }
      }
    ),
    
    // Delete file
    tool(
      'delete_file',
      'Delete a file from the current app (commits the deletion)',
      {
        path: z.string().describe('Relative path to delete'),
        message: z.string().describe('Git commit message')
      },
      async ({ path, message }) => {
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid path' }]
          }
        }
        
        try {
          const relativePath = fullPath.replace(rootPath + '/', '')
          
          // Remove file
          await rm(fullPath)
          
          // Git remove and commit
          await git.remove({ fs, dir: rootPath, filepath: relativePath })
          
          const oid = await git.commit({
            fs,
            dir: rootPath,
            message,
            author: AUTHOR
          })
          
          return {
            content: [{
              type: 'text',
              text: `Deleted ${relativePath} (committed: ${oid.slice(0, 7)})`
            }]
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error deleting file: ${errorMessage}` }] }
        }
      }
    ),
    
    // Version control: create branch
    tool(
      'create_branch',
      'Create a new git branch in the current app',
      {
        name: z.string().describe('Branch name (e.g., "feature-dark-mode")')
      },
      async ({ name }) => {
        try {
          await versionManager.createBranch({ name })
          return {
            content: [{ type: 'text', text: `Created and switched to branch '${name}'` }]
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Version control: switch branch
    tool(
      'switch_branch',
      'Switch to a different branch',
      {
        name: z.string().describe('Branch name to switch to')
      },
      async ({ name }) => {
        try {
          await versionManager.switchBranch(name)
          return {
            content: [{ type: 'text', text: `Switched to branch '${name}'` }]
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Version control: list branches
    tool(
      'list_branches',
      'List all branches in the current app',
      {},
      async () => {
        try {
          const branches = await versionManager.listBranches()
          const formatted = branches
            .map(b => `${b.isCurrent ? '* ' : '  '}${b.name}`)
            .join('\n')
          return { content: [{ type: 'text', text: formatted }] }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Version control: history
    tool(
      'get_history',
      'Get recent commit history',
      {
        count: z.number().optional().describe('Number of commits (default: 10)')
      },
      async ({ count = 10 }) => {
        try {
          const history = await versionManager.getHistory({ depth: count })
          const formatted = history
            .map(c => `${c.oid.slice(0, 7)} ${c.message}`)
            .join('\n')
          return { content: [{ type: 'text', text: formatted || 'No commits yet' }] }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Version control: rollback
    tool(
      'rollback',
      'Rollback to a previous commit',
      {
        commit: z.string().describe('Commit SHA to rollback to (first 7 chars ok)')
      },
      async ({ commit }) => {
        try {
          await versionManager.rollback(commit)
          return {
            content: [{ type: 'text', text: `Rolled back to ${commit}` }]
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Version control: status
    tool(
      'git_status',
      'Get current git status',
      {},
      async () => {
        try {
          const state = await versionManager.getState()
          let status = `Branch: ${state.currentBranch}\nHEAD: ${state.head.slice(0, 7)}`
          if (state.hasChanges) {
            status += `\n\nUncommitted changes:\n${state.modifiedFiles.map(f => `  - ${f}`).join('\n')}`
          } else {
            status += '\n\nNo uncommitted changes'
          }
          return { content: [{ type: 'text', text: status }] }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    ),
    
    // Run command
    tool(
      'run_command',
      'Run a shell command in the app directory',
      {
        command: z.string().describe('Command to run (e.g., "bun install", "bun run build")')
      },
      async ({ command }) => {
        // Block dangerous patterns
        const blocked = ['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']
        if (blocked.some(b => command.includes(b))) {
          return {
            content: [{ type: 'text', text: 'Error: Command blocked for safety' }]
          }
        }
        
        try {
          const { exec } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execAsync = promisify(exec)
          
          const { stdout, stderr } = await execAsync(command, {
            cwd: rootPath,
            timeout: 60000 // 1 minute timeout
          })
          
          const output = stdout || stderr || '(no output)'
          return { content: [{ type: 'text', text: output }] }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return { content: [{ type: 'text', text: `Error: ${message}` }] }
        }
      }
    )
  ]
}
```

---

## Task 2: Dynamic System Prompt

### Add to apps/electron/src/main/agent.ts

```typescript
import type { SubApp, AppTemplate } from '@pitaster/core'

const TEMPLATE_HINTS: Record<AppTemplate, string> = {
  'react-vite': `
## File Structure
- src/main.tsx - Entry point
- src/App.tsx - Main component
- src/index.css - Tailwind styles
- vite.config.ts - Vite configuration
- index.html - HTML template

## Commands
- \`bun install\` - Install dependencies
- \`bun run dev\` - Start dev server
- \`bun run build\` - Production build`,

  'node-cli': `
## File Structure
- src/index.ts - CLI entry point

## Commands
- \`bun run src/index.ts\` - Run the CLI
- \`bun run build\` - Compile TypeScript`,

  'node-server': `
## File Structure
- src/index.ts - Server entry (Hono framework)

## Commands
- \`bun install\` - Install dependencies
- \`bun run dev\` - Start with watch mode
- \`bun run start\` - Start server`,

  'static-site': `
## File Structure
- index.html - Main HTML
- styles.css - Stylesheet
- script.js - JavaScript

## Commands
- \`npx serve .\` - Local dev server`,

  'blank': `
## File Structure
This is a blank project. Create files as needed.`
}

/**
 * Generate system prompt based on active app context.
 */
export function getSystemPrompt(app: SubApp | null): string {
  if (!app) {
    return `You are Pi Taster, an AI assistant that helps users create and manage applications.

Currently, no app is selected. You should guide the user to:
1. Select an existing app from the Apps panel (📱 icon)
2. Create a new app using the "New App" button

Once an app is selected, you'll be able to help modify its code, manage versions, and run commands.`
  }

  return `You are Pi Taster, an AI assistant helping develop "${app.name}".

## Current App Context
- **Name**: ${app.name}
- **Template**: ${app.template}
- **Description**: ${app.description || '(no description)'}
- **Branch**: ${app.currentBranch || 'main'}
${app.hasChanges ? '- **Status**: Uncommitted changes present' : ''}

## Available Tools
- \`read_file\` - Read file contents
- \`write_file\` - Create/modify files (auto-commits)
- \`list_files\` - List directory contents
- \`delete_file\` - Remove files (commits deletion)
- \`create_branch\` - Create new branch
- \`switch_branch\` - Switch branches
- \`list_branches\` - Show all branches
- \`get_history\` - View commit history
- \`rollback\` - Restore previous state
- \`git_status\` - Check uncommitted changes
- \`run_command\` - Run shell commands
${TEMPLATE_HINTS[app.template]}

## Guidelines
1. **Read before writing**: Always read a file before modifying it
2. **Use branches for experiments**: Create a branch before risky changes
3. **Keep changes focused**: One logical change per commit
4. **Explain your actions**: Tell the user what you're doing and why
5. **Test when possible**: Run the app after changes to verify they work`
}
```

---

## Task 3: Wire Up Scoped Tools in Agent Query

### Update the query function in apps/electron/src/main/agent.ts

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode } from '@pitaster/core'

export async function runAgentQuery(
  prompt: string,
  permissionMode: PermissionMode,
  onStream: (chunk: StreamChunk) => void
): Promise<void> {
  const app = await getActiveApp()
  const systemPrompt = getSystemPrompt(app)
  const tools = await createScopedTools()
  
  // ... rest of query implementation using systemPrompt and tools
}
```

---

## Verification Checklist

- [ ] `normalizePath` prevents `..` traversal
- [ ] `normalizePath` prevents absolute paths
- [ ] Tools return error when no app selected
- [ ] File operations respect app boundary
- [ ] Git commits work within app repo
- [ ] System prompt reflects active app
- [ ] Dangerous commands are blocked
- [ ] `bun run typecheck:all` passes

## Security Tests

```typescript
// These should all fail gracefully:
await tools.read_file({ path: '../../../etc/passwd' })
await tools.read_file({ path: '/etc/passwd' })
await tools.write_file({ path: '../../outside.txt', content: 'bad', message: 'hack' })
await tools.run_command({ command: 'rm -rf /' })
```

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.5): scope agent operations to active app

- Add path normalization to prevent directory traversal
- Scope all file tools to app directory
- Dynamic system prompt based on app context
- Block dangerous shell commands
- Return helpful error when no app selected"
```

---

## Next

Proceed to **SESSION-6.6-INTEGRATION.md** to integrate everything into the main app.
