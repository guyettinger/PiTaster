/**
 * Claude Agent integration with scoped self-modification tools.
 * All file operations are sandboxed to the active sub-app directory.
 */

import Anthropic, { APIError } from '@anthropic-ai/sdk'
import { promises as fs } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import * as git from 'isomorphic-git'
import nodeFs from 'node:fs'
import { VersionManager, SkillsLoader, extractSkillMentions, buildSystemPrompt } from '@anyapp/shared'
import type { Commit, Branch, Skill, SubApp, AppTemplate } from '@anyapp/core'

/** Permission mode type for tool execution. */
export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Default author for git commits. */
const AUTHOR = { name: 'anyapp Agent', email: 'agent@anyapp.local' }

/** Blocked shell command patterns for safety. */
const BLOCKED_COMMANDS = ['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']

/** Maximum number of retries on 429 rate-limit errors. */
const MAX_RATE_LIMIT_RETRIES = 3
/** Default wait time (seconds) when retry-after header is missing. */
const DEFAULT_RETRY_AFTER_SECONDS = 60

/**
 * Normalize and validate a path to prevent directory traversal.
 * Returns null if the path would escape the root.
 * @param rootPath - The root directory path
 * @param relativePath - The relative path to normalize
 * @returns The normalized full path, or null if invalid
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

/** Stream chunk from agent response. */
export interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit'
  text?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  /** Seconds until retry (for 'rate_limit' type). */
  retryAfterSeconds?: number
}

/**
 * Summarizes tool output for display (avoids showing huge file contents).
 */
function summarizeOutput(result: string): string {
  if (result.length > 500) {
    return result.slice(0, 500) + '\n...(truncated)'
  }
  return result
}

/** Anthropic SDK types */
type Tool = Anthropic.Tool
export type MessageParam = Anthropic.MessageParam
type ToolResultBlockParam = Anthropic.ToolResultBlockParam

const execAsync = promisify(exec)

/** Project root directory - defaults to cwd, can be set via setProjectRoot. */
let PROJECT_ROOT = process.cwd()

/** Version manager instance - initialized lazily. */
let versionManager: VersionManager | null = null

/**
 * Get or create the version manager instance.
 */
function getVersionManager(): VersionManager {
  if (!versionManager) {
    versionManager = new VersionManager(PROJECT_ROOT)
  }
  return versionManager
}

/**
 * Set the project root directory for file operations.
 * @param path - Absolute path to project root
 */
export function setProjectRoot(path: string): void {
  PROJECT_ROOT = path
  // Reset version manager so it uses new path
  versionManager = null
}

/**
 * Get the current project root directory.
 */
export function getProjectRoot(): string {
  return PROJECT_ROOT
}

/**
 * Tool definition with its handler function.
 */
interface ScopedTool {
  definition: Tool
  handler: (input: Record<string, unknown>) => Promise<string>
}

/**
 * Create scoped tools for the active app.
 * Returns limited tools if no app is selected.
 * @param app - The active sub-app, or null if none selected
 * @returns Array of scoped tool definitions and handlers
 */
export function createScopedTools(app: SubApp | null): ScopedTool[] {
  // No app selected - return minimal tool set
  if (!app) {
    return [{
      definition: {
        name: 'no_app_selected',
        description: 'Display message when no app is selected',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      },
      handler: async () => 'No app is currently selected. Please select an app from the Apps panel to begin working.'
    }]
  }

  const rootPath = app.path
  const versionMgr = new VersionManager(rootPath)

  return [
    // File reading
    {
      definition: {
        name: 'read_file',
        description: 'Read a file from the current app',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path within the app' }
          },
          required: ['path']
        }
      },
      handler: async (input) => {
        const path = input.path as string
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return 'Error: Invalid path - cannot access files outside the app'
        }
        try {
          return await fs.readFile(fullPath, 'utf-8')
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error reading file: ${message}`
        }
      }
    },

    // File writing with auto-commit
    {
      definition: {
        name: 'write_file',
        description: 'Write content to a file in the current app (auto-commits to git)',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path within the app' },
            content: { type: 'string', description: 'File content to write' },
            message: { type: 'string', description: 'Git commit message describing the change' }
          },
          required: ['path', 'content', 'message']
        }
      },
      handler: async (input) => {
        const path = input.path as string
        const content = input.content as string
        const commitMessage = input.message as string
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return 'Error: Invalid path - cannot write files outside the app'
        }
        try {
          // Ensure directory exists
          await fs.mkdir(dirname(fullPath), { recursive: true })
          
          // Write file
          await fs.writeFile(fullPath, content)
          
          // Git add and commit
          const relativePath = fullPath.replace(rootPath + '/', '')
          await git.add({ fs: nodeFs, dir: rootPath, filepath: relativePath })
          
          const oid = await git.commit({
            fs: nodeFs,
            dir: rootPath,
            message: commitMessage,
            author: AUTHOR
          })
          
          return `Wrote ${relativePath} (committed: ${oid.slice(0, 7)})`
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error writing file: ${message}`
        }
      }
    },

    // List files
    {
      definition: {
        name: 'list_files',
        description: 'List files in a directory of the current app',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path (default: root)' }
          }
        }
      },
      handler: async (input) => {
        const path = (input.path as string) ?? '.'
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return 'Error: Invalid path'
        }
        try {
          const entries = await fs.readdir(fullPath, { withFileTypes: true })
          const files = entries
            .filter(e => e.name !== '.git' && e.name !== 'node_modules' && !e.name.startsWith('.anyapp'))
            .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
            .join('\n')
          return files || '(empty directory)'
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error listing files: ${message}`
        }
      }
    },

    // Delete file
    {
      definition: {
        name: 'delete_file',
        description: 'Delete a file from the current app (commits the deletion)',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path to delete' },
            message: { type: 'string', description: 'Git commit message' }
          },
          required: ['path', 'message']
        }
      },
      handler: async (input) => {
        const path = input.path as string
        const commitMessage = input.message as string
        const fullPath = normalizePath(rootPath, path)
        if (!fullPath) {
          return 'Error: Invalid path'
        }
        try {
          const relativePath = fullPath.replace(rootPath + '/', '')
          
          // Remove file
          await fs.rm(fullPath)
          
          // Git remove and commit
          await git.remove({ fs: nodeFs, dir: rootPath, filepath: relativePath })
          
          const oid = await git.commit({
            fs: nodeFs,
            dir: rootPath,
            message: commitMessage,
            author: AUTHOR
          })
          
          return `Deleted ${relativePath} (committed: ${oid.slice(0, 7)})`
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          return `Error deleting file: ${errorMessage}`
        }
      }
    },

    // Create branch
    {
      definition: {
        name: 'create_branch',
        description: 'Create a new git branch in the current app',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Branch name (e.g., "feature-dark-mode")' }
          },
          required: ['name']
        }
      },
      handler: async (input) => {
        const name = input.name as string
        try {
          await versionMgr.createBranch({ name })
          return `Created and switched to branch '${name}'`
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // Switch branch
    {
      definition: {
        name: 'switch_branch',
        description: 'Switch to a different branch',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Branch name to switch to' }
          },
          required: ['name']
        }
      },
      handler: async (input) => {
        const name = input.name as string
        try {
          await versionMgr.switchBranch(name)
          return `Switched to branch '${name}'`
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // List branches
    {
      definition: {
        name: 'list_branches',
        description: 'List all branches in the current app',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      },
      handler: async () => {
        try {
          const branches = await versionMgr.listBranches()
          const formatted = branches
            .map((b: Branch) => `${b.isCurrent ? '* ' : '  '}${b.name}`)
            .join('\n')
          return formatted || 'No branches'
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // Get history
    {
      definition: {
        name: 'get_history',
        description: 'Get recent commit history',
        input_schema: {
          type: 'object' as const,
          properties: {
            count: { type: 'number', description: 'Number of commits (default: 10)' }
          }
        }
      },
      handler: async (input) => {
        const count = (input.count as number) ?? 10
        try {
          const history = await versionMgr.getHistory({ depth: count })
          const formatted = history
            .map((c: Commit) => `${c.oid.slice(0, 7)} ${c.message}`)
            .join('\n')
          return formatted || 'No commits yet'
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // Rollback
    {
      definition: {
        name: 'rollback',
        description: 'Rollback to a previous commit',
        input_schema: {
          type: 'object' as const,
          properties: {
            commit: { type: 'string', description: 'Commit SHA to rollback to (first 7 chars ok)' }
          },
          required: ['commit']
        }
      },
      handler: async (input) => {
        const commit = input.commit as string
        try {
          await versionMgr.rollback(commit)
          return `Rolled back to ${commit}`
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // Git status
    {
      definition: {
        name: 'git_status',
        description: 'Get current git status',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      },
      handler: async () => {
        try {
          const state = await versionMgr.getState()
          let status = `Branch: ${state.currentBranch}\nHEAD: ${state.head.slice(0, 7)}`
          if (state.hasChanges) {
            status += `\n\nUncommitted changes:\n${state.modifiedFiles.map(f => `  - ${f}`).join('\n')}`
          } else {
            status += '\n\nNo uncommitted changes'
          }
          return status
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    },

    // Run command
    {
      definition: {
        name: 'run_command',
        description: 'Run a shell command in the app directory',
        input_schema: {
          type: 'object' as const,
          properties: {
            command: { type: 'string', description: 'Command to run (e.g., "bun install", "bun run build")' }
          },
          required: ['command']
        }
      },
      handler: async (input) => {
        const command = input.command as string
        
        // Block dangerous patterns
        if (BLOCKED_COMMANDS.some(b => command.includes(b))) {
          return 'Error: Command blocked for safety'
        }
        
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: rootPath,
            timeout: 60000 // 1 minute timeout
          })
          
          const output = stdout || stderr || '(no output)'
          return output
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return `Error: ${message}`
        }
      }
    }
  ]
}

/**
 * Self-modification tools available to the agent.
 * @deprecated Use createScopedTools() instead for app-scoped operations
 */
export const selfModifyTools: Tool[] = [
  {
    name: 'read_source',
    description: 'Read a source file from the project. Returns the file contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to source file from project root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_source',
    description: 'Write content to a source file. Creates directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to source file from project root'
        },
        content: {
          type: 'string',
          description: 'New file content'
        },
        message: {
          type: 'string',
          description: 'Brief description of the change'
        }
      },
      required: ['path', 'content', 'message']
    }
  },
  {
    name: 'list_files',
    description: 'List files in a directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to directory from project root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'rebuild_app',
    description: 'Run the build command and return the result.',
    input_schema: {
      type: 'object' as const,
      properties: {}
    }
  },
  {
    name: 'run_typecheck',
    description: 'Run TypeScript type checking across the project.',
    input_schema: {
      type: 'object' as const,
      properties: {}
    }
  },
  // Version control tools
  {
    name: 'version_create_branch',
    description: 'Create a new branch for experimental changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'version_switch_branch',
    description: 'Switch to a different branch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branchName: {
          type: 'string',
          description: 'Branch name to switch to'
        }
      },
      required: ['branchName']
    }
  },
  {
    name: 'version_rollback',
    description: 'Rollback to a previous commit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        commitId: {
          type: 'string',
          description: 'Commit SHA (first 7 chars ok)'
        }
      },
      required: ['commitId']
    }
  },
  {
    name: 'version_history',
    description: 'Get commit history for current branch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        depth: {
          type: 'number',
          description: 'Max commits to return (default 10)'
        }
      }
    }
  },
  {
    name: 'version_list_branches',
    description: 'List all branches.',
    input_schema: {
      type: 'object' as const,
      properties: {}
    }
  },
  {
    name: 'version_merge',
    description: 'Merge another branch into current.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branchName: {
          type: 'string',
          description: 'Branch to merge'
        }
      },
      required: ['branchName']
    }
  },
  {
    name: 'version_status',
    description: 'Get current version control status.',
    input_schema: {
      type: 'object' as const,
      properties: {}
    }
  }
]

/**
 * Execute a self-modification tool.
 * @param toolName - Name of the tool to execute
 * @param input - Tool input parameters
 * @returns Tool execution result as string
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case 'read_source': {
      const path = input.path as string
      const fullPath = resolve(PROJECT_ROOT, path)
      try {
        const content = await fs.readFile(fullPath, 'utf-8')
        return content
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          return `Error: File not found: ${path}`
        }
        throw error
      }
    }

    case 'write_source': {
      const path = input.path as string
      const content = input.content as string
      const message = input.message as string
      const fullPath = resolve(PROJECT_ROOT, path)
      
      // Create directory if needed
      const dir = resolve(fullPath, '..')
      await fs.mkdir(dir, { recursive: true })
      
      await fs.writeFile(fullPath, content)
      
      // Auto-commit the change
      try {
        const vm = getVersionManager()
        const commit = await vm.commit({ message, files: [path] })
        return `Wrote ${path} (committed: ${commit.oid.slice(0, 7)}): ${message}`
      } catch {
        // If git commit fails (e.g., not a git repo), just report the write
        return `Wrote ${path}: ${message}`
      }
    }

    case 'list_files': {
      const path = input.path as string
      const fullPath = resolve(PROJECT_ROOT, path)
      try {
        const entries = await fs.readdir(fullPath, { withFileTypes: true })
        const files = entries
          .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n')
        return files || '(empty directory)'
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          return `Error: Directory not found: ${path}`
        }
        throw error
      }
    }

    case 'rebuild_app': {
      try {
        const { stdout, stderr } = await execAsync('bun run build', { 
          cwd: PROJECT_ROOT,
          timeout: 120000 // 2 minute timeout
        })
        return stdout || 'Build successful'
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message: string }
        return `Build failed:\n${err.stdout || ''}\n${err.stderr || err.message}`
      }
    }

    case 'run_typecheck': {
      try {
        const { stdout } = await execAsync('bun run typecheck:all', { 
          cwd: PROJECT_ROOT,
          timeout: 120000 // 2 minute timeout
        })
        return stdout || 'No type errors'
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message: string }
        return `Type errors:\n${err.stdout || err.message}`
      }
    }

    // Version control tools
    case 'version_create_branch': {
      const name = input.name as string
      const vm = getVersionManager()
      await vm.createBranch({ name })
      return `Created and switched to branch '${name}'`
    }

    case 'version_switch_branch': {
      const branchName = input.branchName as string
      const vm = getVersionManager()
      await vm.switchBranch(branchName)
      return `Switched to branch '${branchName}'`
    }

    case 'version_rollback': {
      const commitId = input.commitId as string
      const vm = getVersionManager()
      await vm.rollback(commitId)
      return `Rolled back to ${commitId}`
    }

    case 'version_history': {
      const depth = (input.depth as number) ?? 10
      const vm = getVersionManager()
      const history = await vm.getHistory({ depth })
      const formatted = history
        .map((c: Commit) => `- ${c.oid.slice(0, 7)}: "${c.message}" (${c.timestamp})`)
        .join('\n')
      return formatted || 'No commits yet'
    }

    case 'version_list_branches': {
      const vm = getVersionManager()
      const branches = await vm.listBranches()
      const formatted = branches.map((b: Branch) => `- ${b.name}${b.isCurrent ? ' (current)' : ''}`).join('\n')
      return formatted || 'No branches'
    }

    case 'version_merge': {
      const branchName = input.branchName as string
      const vm = getVersionManager()
      const result = await vm.merge(branchName)
      if (result.success) {
        return `Merged '${branchName}' successfully`
      } else {
        return `Merge conflicts detected`
      }
    }

    case 'version_status': {
      const vm = getVersionManager()
      const state = await vm.getState()
      let status = `Branch: ${state.currentBranch}\nHEAD: ${state.head.slice(0, 7)}`
      if (state.hasChanges) {
        status += `\nUncommitted: ${state.modifiedFiles.join(', ')}`
      }
      return status
    }

    default:
      return `Unknown tool: ${toolName}`
  }
}

/**
 * Check if a tool should be allowed based on permission mode.
 * @param permissionMode - Current permission mode
 * @param toolName - Tool being requested
 * @returns Object with behavior and optional message
 */
export function checkPermission(
  permissionMode: PermissionMode,
  toolName: string
): { behavior: 'allow' | 'deny' | 'ask'; message?: string } {
  // Plan mode: deny all tools
  if (permissionMode === 'plan') {
    return { behavior: 'deny', message: 'Read-only mode active' }
  }

  // Bypass mode: allow everything
  if (permissionMode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }

  // Accept edits mode: allow file operations and version control, ask for others
  if (permissionMode === 'acceptEdits') {
    // New scoped file tools
    const scopedFileTools = ['read_file', 'write_file', 'list_files', 'delete_file']
    // New scoped version control tools
    const scopedVersionTools = [
      'create_branch',
      'switch_branch',
      'list_branches',
      'get_history',
      'rollback',
      'git_status'
    ]
    // Legacy tool names (for backward compatibility)
    const legacyFileTools = ['read_source', 'write_source']
    const legacyVersionTools = [
      'version_create_branch',
      'version_switch_branch',
      'version_rollback',
      'version_history',
      'version_list_branches',
      'version_merge',
      'version_status'
    ]
    // Always allow no_app_selected (it's informational)
    if (toolName === 'no_app_selected') {
      return { behavior: 'allow' }
    }
    const allFileTools = [...scopedFileTools, ...legacyFileTools]
    const allVersionTools = [...scopedVersionTools, ...legacyVersionTools]
    if (allFileTools.includes(toolName) || allVersionTools.includes(toolName)) {
      return { behavior: 'allow' }
    }
  }

  // Default mode: ask for approval
  return { behavior: 'ask' }
}

/** Skills loader instance - initialized lazily. */
let skillsLoader: SkillsLoader | null = null

/**
 * Get or create the skills loader instance.
 */
function getSkillsLoader(): SkillsLoader {
  if (!skillsLoader) {
    const skillsDir = join(homedir(), '.anyapp', 'skills')
    skillsLoader = new SkillsLoader(skillsDir)
  }
  return skillsLoader
}

/** Template-specific hints for the system prompt. */
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
 * @param app - The active sub-app, or null if none selected
 * @returns The system prompt string
 */
export function getSystemPrompt(app: SubApp | null): string {
  if (!app) {
    return `You are anyapp, an AI assistant that helps users create and manage applications.

Currently, no app is selected. You should guide the user to:
1. Select an existing app from the Apps panel
2. Create a new app using the "New App" button

Once an app is selected, you'll be able to help modify its code, manage versions, and run commands.`
  }

  return `You are anyapp, an AI assistant helping develop "${app.name}".

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

/** Base system prompt for the self-modifying agent (legacy, for backward compatibility). */
const BASE_SYSTEM_PROMPT = `You are anyapp, a self-modifying AI assistant embedded in an Electron app.

You can help users create and manage applications. Select an app from the Apps panel to begin working on it.`

/**
 * Parameters for running an agent query.
 */
export interface RunAgentQueryParams {
  /** The user's prompt/message. */
  prompt: string
  /** Current permission mode. */
  permissionMode: PermissionMode
  /** Callback to request user approval for a tool. */
  requestApproval: (tool: string, input: unknown) => Promise<boolean>
  /** Callback for stream chunks. */
  onStream: (chunk: StreamChunk) => void
  /** Previous conversation messages for continuity. */
  conversationHistory?: MessageParam[]
  /** Abort signal for cancellation. */
  signal?: AbortSignal
  /** The currently active sub-app, or null if none selected. */
  activeApp?: SubApp | null
}

/**
 * Run an agent query with streaming and tool use.
 * @param params - Query parameters
 * @returns Updated conversation history
 */
export async function runAgentQuery(params: RunAgentQueryParams): Promise<MessageParam[]> {
  const { prompt, permissionMode, requestApproval, onStream, conversationHistory = [], signal, activeApp = null } = params

  const client = new Anthropic()
  
  // Extract skill mentions and load skills
  const mentions = extractSkillMentions(prompt)
  const loader = getSkillsLoader()
  const loadedSkills: Skill[] = []
  
  for (const mention of mentions) {
    try {
      const skill = await loader.load(mention.name)
      if (skill) {
        loadedSkills.push(skill)
      }
    } catch {
      // Skill not found, continue without it
    }
  }
  
  // Generate dynamic system prompt based on active app
  const basePrompt = getSystemPrompt(activeApp)
  const systemPrompt = buildSystemPrompt(basePrompt, loadedSkills)
  
  // Create scoped tools for the active app
  const scopedTools = createScopedTools(activeApp)
  const toolDefinitions = scopedTools.map(t => t.definition)
  const toolHandlers = new Map(scopedTools.map(t => [t.definition.name, t.handler]))
  
  // Build messages with conversation history
  const messages: MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: prompt }
  ]

  // Agentic loop - continue until no more tool use
  let continueLoop = true
  let rateLimitRetries = 0
  
  while (continueLoop) {
    continueLoop = false
    
    try {
      // Create streaming message with scoped tools
      const stream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        tools: toolDefinitions,
        messages
      })

      let currentText = ''
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

      // Process stream events
      for await (const event of stream) {
        if (signal?.aborted) {
          onStream({ type: 'error', error: 'Request cancelled' })
          return messages
        }

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // Text block starting
          } else if (event.content_block.type === 'tool_use') {
            onStream({ type: 'tool_start', tool: event.content_block.name })
            toolUseBlocks.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: {}
            })
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            currentText += event.delta.text
            onStream({ type: 'text', text: event.delta.text })
          } else if (event.delta.type === 'input_json_delta') {
            // Accumulate tool input JSON - will be parsed when complete
          }
        } else if (event.type === 'content_block_stop') {
          // Block completed
        }
      }

      // Get the final message
      const finalMessage = await stream.finalMessage()
      
      // Add assistant response to messages
      messages.push({ role: 'assistant', content: finalMessage.content })

      // Check if we need to handle tool use
      if (finalMessage.stop_reason === 'tool_use') {
        const toolResults: ToolResultBlockParam[] = []

        for (const block of finalMessage.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name
            const toolInput = block.input as Record<string, unknown>

            // Emit tool_start with input (updates the running tool with complete input)
            onStream({ type: 'tool_start', tool: toolName, input: toolInput })

            // Check permissions
            const permission = checkPermission(permissionMode, toolName)
            
            let result: string
            if (permission.behavior === 'deny') {
              result = `Tool denied: ${permission.message || 'Permission denied'}`
            } else if (permission.behavior === 'ask') {
              const approved = await requestApproval(toolName, toolInput)
              if (approved) {
                // Execute using scoped tool handler
                const handler = toolHandlers.get(toolName)
                result = handler ? await handler(toolInput) : `Unknown tool: ${toolName}`
              } else {
                result = 'Tool denied by user'
              }
            } else {
              // Execute using scoped tool handler
              const handler = toolHandlers.get(toolName)
              result = handler ? await handler(toolInput) : `Unknown tool: ${toolName}`
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result
            })

            onStream({ type: 'tool_end', tool: toolName, output: summarizeOutput(result) })
          }
        }

        // Add tool results to messages
        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults })
          continueLoop = true // Continue the loop to get agent's response to tool results
        }
      }
    } catch (error) {
      // 429 rate-limit: retry with backoff
      if (error instanceof APIError && error.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterHeader = error.headers?.['retry-after']
        const retryAfterSeconds = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) || DEFAULT_RETRY_AFTER_SECONDS
          : DEFAULT_RETRY_AFTER_SECONDS

        rateLimitRetries++
        onStream({ type: 'rate_limit', retryAfterSeconds })
        await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000))
        continueLoop = true
        continue
      }

      // All other errors (or retries exhausted): surface to user, no retry
      const err = error as Error
      onStream({ type: 'error', error: err.message })
      return messages
    }
  }

  onStream({ type: 'complete' })
  return messages
}
