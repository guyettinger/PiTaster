/**
 * Permission gating and path confinement for Pi's tools.
 *
 * Pi ships no sandbox: its built-in `read`, `write`, `edit`, and `bash` tools run with
 * the permissions of the host process, and `resolveToCwd` expands `~` and passes
 * absolute paths straight through without a containment check. Adopting those tools
 * therefore moves anyapp's confinement out of the tools and into this handler.
 *
 * That is a real change in kind. Previously a file tool physically could not be handed
 * a path outside the sub-app root, and `run_command` always executed with
 * `cwd: rootPath`. Now a single `tool_call` handler is the whole boundary, so a bug
 * here is a full escape. The path checks are exact; the shell check is best-effort and
 * documented as such on {@link inspectCommand}.
 *
 * MCP source tools are the one part of the surface {@link checkConfinement} cannot
 * police. They carry no anyapp-resolved path, they execute inside a separate server
 * process the user configured, and their reach is whatever that server exposes.
 * Approval is their entire boundary, which is why {@link checkPermission} never
 * auto-approves one outside `bypassPermissions`.
 */

import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { PermissionMode } from '@anyapp/core'
import { isMcpToolName } from './mcp-tools'

/**
 * Shell command patterns that are refused outright, in every permission mode.
 * Ported verbatim from the pre-Pi `run_command` tool.
 */
const BLOCKED_COMMANDS = ['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']

/**
 * Pi built-in tools whose arguments include a filesystem `path`.
 * Every path-bearing built-in uses that same key.
 */
const PATH_TOOLS = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls'])

/** Tools auto-approved in `acceptEdits` mode: reads and writes within the app root. */
const FILE_TOOLS = ['read', 'write', 'edit', 'grep', 'find', 'ls']

/** Version-control tools auto-approved in `acceptEdits` mode. */
const VERSION_TOOLS = [
  'create_branch',
  'switch_branch',
  'list_branches',
  'get_history',
  'rollback',
  'git_status'
]

/**
 * The outcome of a permission check.
 */
export interface PermissionResult {
  /** What to do with the tool call. */
  behavior: 'allow' | 'deny' | 'ask'
  /** Human-readable reason, when denying. */
  message?: string
}

/**
 * A tool call being considered for execution.
 */
export interface ToolCallDescriptor {
  /** Name of the tool. */
  toolName: string
  /** Arguments the model supplied. */
  input: Record<string, unknown>
}

/**
 * Decide whether a tool may run under the current permission mode.
 *
 * Anything unclassified falls through to `ask` rather than `allow`, so a tool added
 * later cannot silently gain auto-approval.
 *
 * @param permissionMode - The active permission mode
 * @param toolName - Name of the tool being requested
 * @returns Whether to allow, deny, or prompt the user
 */
export function checkPermission(
  permissionMode: PermissionMode,
  toolName: string
): PermissionResult {
  if (permissionMode === 'plan') {
    return { behavior: 'deny', message: 'Read-only mode active' }
  }

  if (permissionMode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }

  // MCP tools reach outside the app root into a process anyapp does not control,
  // and no path check applies to them. Like `bash`, they always reach the user.
  if (isMcpToolName(toolName)) {
    return { behavior: 'ask' }
  }

  if (permissionMode === 'acceptEdits') {
    // `bash` is deliberately absent: arbitrary shell is never auto-approved.
    if (FILE_TOOLS.includes(toolName) || VERSION_TOOLS.includes(toolName)) {
      return { behavior: 'allow' }
    }
  }

  return { behavior: 'ask' }
}

/**
 * Resolve a model-supplied path the way Pi will.
 *
 * Pi's `resolveToCwd` expands a leading `~`, strips a leading `@`, normalizes unicode
 * spaces, and resolves against the working directory. `resolveReadPath` additionally
 * tries NFD, curly-quote, and macOS AM/PM variants, but those only ever vary the
 * basename, so a containment check on this result stays sound.
 *
 * @param path - The path as the model wrote it
 * @param rootPath - The sub-app root, used as the working directory
 * @returns The absolute path Pi will act on
 */
export function resolveLikePi(path: string, rootPath: string): string {
  let candidate = path.replace(/ | /g, ' ').trim()

  if (candidate.startsWith('@')) {
    candidate = candidate.slice(1)
  }
  if (candidate === '~') {
    candidate = homedir()
  } else if (candidate.startsWith(`~${sep}`) || candidate.startsWith('~/')) {
    candidate = resolve(homedir(), candidate.slice(2))
  }

  return resolve(rootPath, candidate)
}

/**
 * Test whether an absolute path lies inside a root directory.
 *
 * Uses a path-segment comparison rather than `startsWith`, which would accept a
 * sibling directory sharing a name prefix.
 *
 * @param rootPath - The directory that must contain the target
 * @param absolutePath - The resolved absolute path to test
 * @returns True when the path is the root or lies beneath it
 */
export function isWithinRoot(rootPath: string, absolutePath: string): boolean {
  const rel = relative(resolve(rootPath), absolutePath)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Inspect a shell command for obviously out-of-bounds behaviour.
 *
 * **This is best-effort, not confinement.** Shell strings are not reliably parseable:
 * variable expansion (`ls $HOME`), command substitution (`ls $(echo ..)`), and
 * indirection all defeat token scanning. It catches literal paths, which is what a
 * model actually reaches for — when the `ls` tool refuses `../..`, the observed next
 * move is `bash ls ../..` — but it does not make `bash` safe. That is why `bash` is
 * never auto-approved outside `bypassPermissions` and always reaches the user for
 * confirmation in `default` and `acceptEdits`.
 *
 * @param command - The command string the model produced
 * @param rootPath - The sub-app root
 * @returns A refusal reason, or null when nothing obvious was found
 */
export function inspectCommand(command: string, rootPath: string): string | null {
  const lowered = command.toLowerCase()
  for (const blocked of BLOCKED_COMMANDS) {
    if (lowered.includes(blocked.toLowerCase())) {
      return `Blocked command pattern: ${blocked}`
    }
  }

  // Flag literal paths that point outside the app root. Tokens must start at a
  // shell word boundary, or `src/App.tsx` would match its own `/App.tsx`.
  //
  // Both absolute/home-relative tokens (`/etc/passwd`, `~/.ssh/id_rsa`) and
  // relative traversals (`../..`) are checked. The traversal case is not
  // hypothetical: a model refused by the `ls` tool will reach for `bash ls ../..`
  // as its next move.
  const tokens = command.match(/(?<=^|[\s;|&(<>=])[^\s'"`;|&()<>]+/g) ?? []
  for (const token of tokens) {
    const isRooted = token.startsWith('/') || token.startsWith('~')
    const hasTraversal = token === '..' || /(?:^|\/)\.\.(?:\/|$)/.test(token)
    if (!isRooted && !hasTraversal) continue

    if (!isWithinRoot(rootPath, resolveLikePi(token, rootPath))) {
      return `Path outside the app directory: ${token}`
    }
  }

  return null
}

/**
 * Check that a tool call stays inside the sub-app root.
 * @param call - The tool name and arguments
 * @param rootPath - The sub-app root
 * @returns A refusal reason, or null when the call is in bounds
 */
export function checkConfinement(
  call: ToolCallDescriptor,
  rootPath: string
): string | null {
  if (call.toolName === 'bash' || call.toolName === 'powershell') {
    const command = call.input.command
    if (typeof command !== 'string') {
      return 'Missing command'
    }
    return inspectCommand(command, rootPath)
  }

  if (PATH_TOOLS.has(call.toolName)) {
    const path = call.input.path
    // `ls`, `grep`, and `find` treat an absent path as "the working directory".
    if (path === undefined || path === null) return null
    if (typeof path !== 'string') {
      return 'Invalid path'
    }
    if (!isWithinRoot(rootPath, resolveLikePi(path, rootPath))) {
      return `Path outside the app directory: ${path}`
    }
  }

  return null
}
