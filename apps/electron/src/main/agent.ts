/**
 * Claude Agent integration with self-modification tools.
 */

import Anthropic from '@anthropic-ai/sdk'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { VersionManager, SkillsLoader, extractSkillMentions, buildSystemPrompt } from '@clirabbit/shared'
import type { Commit, Branch, Skill } from '@clirabbit/core'

/** Permission mode type for tool execution. */
export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Stream chunk from agent response. */
export interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  text?: string
  tool?: string
  error?: string
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
 * Self-modification tools available to the agent.
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
    const fileTools = ['read_source', 'write_source', 'list_files']
    const versionTools = [
      'version_create_branch',
      'version_switch_branch',
      'version_rollback',
      'version_history',
      'version_list_branches',
      'version_merge',
      'version_status'
    ]
    if (fileTools.includes(toolName) || versionTools.includes(toolName)) {
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
    const skillsDir = join(homedir(), '.clirabbit', 'skills')
    skillsLoader = new SkillsLoader(skillsDir)
  }
  return skillsLoader
}

/** Base system prompt for the self-modifying agent. */
const BASE_SYSTEM_PROMPT = `You are CLIRabbit, a self-modifying AI assistant embedded in an Electron app. You can read and modify your own source code using the available tools.

You have access to these tools:

File Operations:
- read_source: Read source files from the project
- write_source: Write/modify source files (auto-commits changes)
- list_files: List directory contents

Build Tools:
- rebuild_app: Build the project
- run_typecheck: Run TypeScript type checking

Version Control:
- version_create_branch: Create a new branch for experiments
- version_switch_branch: Switch to a different branch
- version_rollback: Rollback to a previous commit
- version_history: View commit history
- version_list_branches: List all branches
- version_merge: Merge a branch into current
- version_status: Get current version control status

When modifying code:
1. Always read the file first to understand the current state
2. Make targeted, minimal changes
3. Run typecheck after modifications
4. Explain what you changed and why

For experimental changes:
1. Create a new branch first
2. Make your changes
3. If successful, merge back to main
4. If unsuccessful, switch back to main (changes are preserved in the branch)

Be helpful but cautious with modifications. Always explain your reasoning.`

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
}

/**
 * Run an agent query with streaming and tool use.
 * @param params - Query parameters
 * @returns Updated conversation history
 */
export async function runAgentQuery(params: RunAgentQueryParams): Promise<MessageParam[]> {
  const { prompt, permissionMode, requestApproval, onStream, conversationHistory = [], signal } = params

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
  
  // Build system prompt with loaded skills
  const systemPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT, loadedSkills)
  
  // Build messages with conversation history
  const messages: MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: prompt }
  ]

  // Agentic loop - continue until no more tool use
  let continueLoop = true
  
  while (continueLoop) {
    continueLoop = false
    
    try {
      // Create streaming message
      const stream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        tools: selfModifyTools,
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

            onStream({ type: 'tool_start', tool: toolName })

            // Check permissions
            const permission = checkPermission(permissionMode, toolName)
            
            let result: string
            if (permission.behavior === 'deny') {
              result = `Tool denied: ${permission.message || 'Permission denied'}`
            } else if (permission.behavior === 'ask') {
              const approved = await requestApproval(toolName, toolInput)
              if (approved) {
                result = await executeTool(toolName, toolInput)
              } else {
                result = 'Tool denied by user'
              }
            } else {
              result = await executeTool(toolName, toolInput)
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result
            })

            onStream({ type: 'tool_end' })
          }
        }

        // Add tool results to messages
        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults })
          continueLoop = true // Continue the loop to get agent's response to tool results
        }
      }
    } catch (error) {
      const err = error as Error
      onStream({ type: 'error', error: err.message })
      return messages
    }
  }

  onStream({ type: 'complete' })
  return messages
}
