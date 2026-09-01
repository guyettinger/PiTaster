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

import { stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { VersionManager } from '@anyapp/shared'

/**
 * Tools whose successful execution should produce a commit.
 *
 * `replace_lines` is anyapp's own, but it modifies a file through the same `path`
 * argument the built-ins use, so it commits by the same route. A file-modifying tool
 * left out of this set writes changes that `rollback` cannot undo.
 */
const COMMITTING_TOOLS = new Set(['write', 'edit', 'replace_lines'])

/**
 * Files `install_deps` may change that belong in version control.
 *
 * `bun install` rewrites the lockfile, which is a real source change: it is what
 * makes the dependency tree reproducible. Without committing it, a `rollback` to
 * a commit predating an install leaves the lockfile at whatever the install
 * wrote — `git checkout` does not remove uncommitted files — so `package.json`
 * and the lockfile silently disagree. `node_modules` is deliberately not here;
 * it is build output, not source.
 */
const INSTALL_ARTIFACTS = ['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock']

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

/**
 * Commit the lockfile after a dependency install.
 *
 * `install_deps` takes no path argument, so it can never reach
 * {@link autoCommitToolResult}, which keys on `input.path`. Its lockfile write
 * would otherwise escape version control entirely and quietly desync `rollback`.
 *
 * Missing lockfiles are skipped rather than treated as failures — which file
 * `bun` writes depends on its version, and an install that changed nothing
 * legitimately leaves the tree clean.
 *
 * @param params - The app root and whether auto-commit is enabled
 * @returns Whether a commit was made, plus a note to surface on failure
 */
export async function autoCommitInstallArtifacts(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Whether the user has auto-commit enabled. */
  enabled: boolean
}): Promise<AutoCommitOutcome> {
  const { rootPath, enabled } = params

  if (!enabled) return { committed: false }

  const present: string[] = []
  for (const name of INSTALL_ARTIFACTS) {
    try {
      await stat(join(rootPath, name))
      present.push(name)
    } catch {
      // Not written by this package manager, or not written by this install.
    }
  }

  if (present.length === 0) return { committed: false }

  try {
    await new VersionManager(rootPath).commit({
      message: `install_deps: ${present.join(', ')}`,
      files: present
    })
    return { committed: true }
  } catch (error) {
    return {
      committed: false,
      note: `\n[auto-commit failed for ${present.join(', ')}: ${(error as Error).message}]`
    }
  }
}

/**
 * Commit an app skill the user wrote or deleted in the Skills panel.
 *
 * App skills live inside the app root and the panel marks them **Versioned**, which is
 * only true if they actually reach git. The agent's own writes get there through
 * {@link autoCommitToolResult}, which is a `tool_result` hook — a panel edit never passes
 * through a tool, so without this the file sits untracked and `rollback` leaves it
 * behind, exactly the way `install_deps` did before it committed its own artifacts.
 *
 * Deletion commits too: `git` records a removal, and a skill that stays in HEAD after
 * being deleted comes back on the next rollback.
 *
 * @param params - The app root, the skill's path relative to it, and the setting
 * @returns Whether a commit was made
 */
export async function autoCommitSkillChange(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** The skill's `SKILL.md`, relative to the app root. */
  relativePath: string
  /** How to describe the change in the commit message. */
  action: 'write' | 'delete'
  /** Whether the user has auto-commit enabled. */
  enabled: boolean
}): Promise<AutoCommitOutcome> {
  const { rootPath, relativePath, action, enabled } = params

  if (!enabled) return { committed: false }

  try {
    await new VersionManager(rootPath).commit({
      message: `${action}: ${relativePath}`,
      files: action === 'delete' ? [] : [relativePath],
      removed: action === 'delete' ? [relativePath] : []
    })
    return { committed: true }
  } catch (error) {
    return {
      committed: false,
      note: `\n[auto-commit failed for ${relativePath}: ${(error as Error).message}]`
    }
  }
}
