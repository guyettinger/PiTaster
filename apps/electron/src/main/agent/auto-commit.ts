/**
 * Git auto-commit for agent file writes.
 *
 * Every write producing a commit is what the versions UI, rollback, and branching are
 * built on. Pi's built-in `write` and `edit` tools know nothing about git, so the
 * commit is made from a `tool_result` handler instead of from inside each tool.
 *
 * This is a behavioural hook rather than a structural guarantee: a write that never
 * reaches this handler will not be committed. Commit failures are therefore surfaced
 * back to the model rather than swallowed, so a broken rollback story is visible
 * instead of silent.
 */

import { relative } from 'node:path'
import { VersionManager } from '@anyapp/shared'

/** Pi built-in tools whose successful execution should produce a commit. */
const COMMITTING_TOOLS = new Set(['write', 'edit'])

/**
 * A completed tool execution, as reported by Pi's `tool_result` event.
 */
export interface ToolResultDescriptor {
  /** Name of the tool that ran. */
  toolName: string
  /** Arguments the tool was called with. */
  input: Record<string, unknown>
  /** Whether the tool reported failure. */
  isError: boolean
}

/**
 * Outcome of an auto-commit attempt.
 */
export interface AutoCommitOutcome {
  /** Whether a commit was made. */
  committed: boolean
  /** Message to append to the tool result, when something went wrong. */
  note?: string
}

/**
 * Commit a file the agent just wrote.
 *
 * @param params - The tool result, the app root, and whether auto-commit is enabled
 * @returns Whether a commit was made, plus a note to surface on failure
 */
export async function autoCommitToolResult(params: {
  /** The completed tool execution. */
  result: ToolResultDescriptor
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Whether the user has auto-commit enabled. */
  enabled: boolean
  /** Absolute path the tool actually acted on. */
  absolutePath: string
}): Promise<AutoCommitOutcome> {
  const { result, rootPath, enabled, absolutePath } = params

  if (!enabled) return { committed: false }
  if (!COMMITTING_TOOLS.has(result.toolName)) return { committed: false }
  if (result.isError) return { committed: false }

  const relativePath = relative(rootPath, absolutePath)
  if (relativePath.length === 0 || relativePath.startsWith('..')) {
    return { committed: false }
  }

  try {
    await new VersionManager(rootPath).commit({
      message: `${result.toolName}: ${relativePath}`,
      files: [relativePath]
    })
    return { committed: true }
  } catch (error) {
    return {
      committed: false,
      note: `\n[auto-commit failed for ${relativePath}: ${(error as Error).message}]`
    }
  }
}
