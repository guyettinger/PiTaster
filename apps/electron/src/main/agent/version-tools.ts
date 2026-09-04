/**
 * Git and version-control tools exposed to the agent.
 *
 * Pi's built-ins cover file and shell work but have no equivalent for Pi Taster's
 * isomorphic-git layer, so these stay as custom tools backed by {@link VersionManager}.
 *
 * Every handler returns its failure as text rather than throwing, matching the
 * pre-Pi behaviour: the model always receives a usable result and can recover.
 */

import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { VersionManager } from '@pitaster/shared'

/** Default number of commits returned by `get_history`. */
const DEFAULT_HISTORY_DEPTH = 10

/** Most commits `get_history` will return, whatever the model asks for. */
const MAX_HISTORY_DEPTH = 200

/**
 * Most paths `git_status` will name before it summarizes the rest.
 *
 * `statusMatrix` reports untracked files as modified, so an app whose `.gitignore` is
 * missing or incomplete answers with every path under `node_modules/` — the case that
 * produced a 422 KB result against a 65k window. The context trimmer catches that
 * too, but only on the way to the model: the untruncated result is still written to
 * Pi's transcript, and a tool that cannot bound its own output is the actual defect.
 *
 * Two hundred paths is far more than a person or a model reads, and an app with more
 * modified files than that has a `.gitignore` problem the count itself points at.
 */
const MAX_STATUS_PATHS = 200

/**
 * Wrap a handler so failures reach the model as text instead of throwing.
 * @param run - The operation to execute
 * @returns A Pi tool result carrying either the output or the error message
 */
async function asToolResult(
  run: () => Promise<string>
): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }> {
  try {
    return { content: [{ type: 'text', text: await run() }], details: {} }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
      details: {}
    }
  }
}

/**
 * Build the version-control tools for one sub-app.
 * @param rootPath - Absolute path to the sub-app root
 * @returns Pi tool definitions backed by {@link VersionManager}
 */
export function createVersionTools(rootPath: string): ToolDefinition[] {
  const vm = new VersionManager(rootPath)

  return [
    defineTool({
      name: 'create_branch',
      label: 'Create branch',
      description:
        'Create a new git branch in the app repository and switch to it. Use this before making risky or experimental changes.',
      parameters: Type.Object({
        name: Type.String({ description: 'Name for the new branch' })
      }),
      execute: async (_toolCallId, { name }) =>
        asToolResult(async () => {
          const branch = await vm.createBranch({ name, checkout: true })
          return `Created and switched to branch "${branch.name}" at ${branch.head.slice(0, 7)}`
        })
    }),

    defineTool({
      name: 'switch_branch',
      label: 'Switch branch',
      description: 'Switch the app repository to an existing branch.',
      parameters: Type.Object({
        name: Type.String({ description: 'Name of the branch to switch to' })
      }),
      execute: async (_toolCallId, { name }) =>
        asToolResult(async () => {
          await vm.switchBranch(name)
          return `Switched to branch "${name}"`
        })
    }),

    defineTool({
      name: 'list_branches',
      label: 'List branches',
      description: 'List all branches in the app repository. The current branch is marked with *.',
      parameters: Type.Object({}),
      execute: async () =>
        asToolResult(async () => {
          const branches = await vm.listBranches()
          if (branches.length === 0) return 'No branches found.'
          return branches
            .map((branch) => `${branch.isCurrent ? '*' : ' '} ${branch.name} (${branch.head.slice(0, 7)})`)
            .join('\n')
        })
    }),

    defineTool({
      name: 'get_history',
      label: 'Commit history',
      description: 'Show recent commits in the app repository, most recent first.',
      parameters: Type.Object({
        count: Type.Optional(
          Type.Number({ description: `Number of commits to return (default ${DEFAULT_HISTORY_DEPTH})` })
        )
      }),
      execute: async (_toolCallId, { count }) =>
        asToolResult(async () => {
          // The model picks this number, so it is clamped rather than trusted.
          const depth = Math.min(MAX_HISTORY_DEPTH, Math.max(1, Math.floor(count ?? DEFAULT_HISTORY_DEPTH)))
          const commits = await vm.getHistory({ depth })
          if (commits.length === 0) return 'No commits yet.'
          return commits
            .map((commit) => `${commit.oid.slice(0, 7)}  ${commit.timestamp}  ${commit.message}`)
            .join('\n')
        })
    }),

    defineTool({
      name: 'rollback',
      label: 'Rollback',
      description:
        'Restore the app to a previous commit. Use get_history first to find the commit SHA.',
      parameters: Type.Object({
        commit: Type.String({ description: 'Commit SHA to roll back to' })
      }),
      execute: async (_toolCallId, { commit }) =>
        asToolResult(async () => {
          await vm.rollback(commit)
          return `Rolled back to ${commit.slice(0, 7)}`
        })
    }),

    defineTool({
      name: 'git_status',
      label: 'Git status',
      description: 'Show the current branch, HEAD commit, and any uncommitted changes.',
      parameters: Type.Object({}),
      execute: async () =>
        asToolResult(async () => {
          const state = await vm.getState()
          const shown = state.modifiedFiles.slice(0, MAX_STATUS_PATHS)
          const hidden = state.modifiedFiles.length - shown.length
          const listing = [
            ...shown.map((f) => `  ${f}`),
            ...(hidden > 0
              ? [
                  `  … and ${hidden} more. This many modified files usually means ` +
                    '.gitignore is missing or incomplete — check it before reading further.'
                ]
              : [])
          ].join('\n')

          const lines = [
            `Branch: ${state.currentBranch}`,
            `HEAD: ${state.head.slice(0, 7)}`,
            state.hasChanges ? `Modified files:\n${listing}` : 'Working tree clean'
          ]
          return lines.join('\n')
        })
    })
  ]
}

/** Names of the version-control tools, for the session's tool allowlist. */
export const VERSION_TOOL_NAMES = [
  'create_branch',
  'switch_branch',
  'list_branches',
  'get_history',
  'rollback',
  'git_status'
] as const
