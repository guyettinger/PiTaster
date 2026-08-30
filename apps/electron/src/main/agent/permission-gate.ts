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
 * Network tools are the one deliberate exception to `plan` being a blanket denial.
 * `web_fetch` issues a GET with no request body, so it cannot write a file, run a
 * command, or modify the app — `plan`'s actual promise. That reasoning depends on
 * the tool staying GET-only; if it ever gains a method or body parameter,
 * {@link checkPermission} must change with it.
 *
 * The exception is narrower than "it only reads", and the difference matters. The
 * model controls the entire URL, so a GET's path and query string carry data *out*:
 * fetching `https://elsewhere.example/?p=<context>` exfiltrates as effectively as a
 * POST. With no host policy and no prompt in `plan` or `acceptEdits`, nothing here
 * prevents that — it is an accepted residual risk, mitigated only by every call and
 * its URL being visible in the transcript. Do not restate this exception as
 * "web_fetch cannot send data anywhere". It can.
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

/**
 * Commands that reach the network, flagged for the approval prompt.
 *
 * Purely informational: {@link describeNetworkUse} never refuses anything. `bash`
 * already requires approval outside `bypassPermissions`, so the value here is
 * letting the user see *why* a command matters before approving it.
 */
const NETWORK_COMMANDS = ['curl', 'wget', 'nc', 'ncat', 'telnet', 'ssh', 'scp', 'rsync', 'ftp']

/**
 * Tools that reach the network without touching the filesystem.
 *
 * Allowed in every mode except `default`, including `plan`. See the note on
 * {@link checkPermission} — this rests on `web_fetch` being a GET with no body.
 */
const NETWORK_TOOLS = ['web_fetch']

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
 * Tools that spawn a subprocess. Deliberately **not** auto-approved in
 * `acceptEdits`, for the same reason `bash` is not.
 *
 * `install_deps` looked safe because its command is fixed — the model cannot
 * choose it. It is not: `bun install` runs the project's own `preinstall` and
 * `postinstall` scripts, and in `acceptEdits` the model can already write
 * `package.json` without asking. Auto-approving the install would therefore hand
 * the model unprompted arbitrary shell, by way of two individually-innocuous
 * steps. Verified empirically, not assumed.
 *
 * Listed here so the classification is explicit rather than a fall-through: a
 * later reader should see that this tool was considered and deliberately left
 * out of the allowlist.
 */
const SUBPROCESS_TOOLS = ['install_deps']

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
 * `plan` denies everything with exactly one exception: {@link NETWORK_TOOLS}. A
 * `web_fetch` is a GET with no request body — it cannot write a file, run a
 * command, or modify the app — so it leaves the machine and the app as it found
 * them, which is what `plan` promises. Letting the agent read documentation while
 * planning is the point. The exception is checked before the `plan` branch, and is
 * sound only while the tool stays GET-only.
 *
 * It does *not* mean the call sends nothing: a model-chosen URL is an egress
 * channel. See the note at the top of this module.
 *
 * @param permissionMode - The active permission mode
 * @param toolName - Name of the tool being requested
 * @returns Whether to allow, deny, or prompt the user
 */
export function checkPermission(
  permissionMode: PermissionMode,
  toolName: string
): PermissionResult {
  // The one `plan` exception: a GET changes nothing, so it is treated like `read`
  // and runs free everywhere except `default`, which prompts for every tool by
  // design. Note this is not the same as sending nothing — see the module note.
  if (NETWORK_TOOLS.includes(toolName)) {
    return permissionMode === 'default' ? { behavior: 'ask' } : { behavior: 'allow' }
  }

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
    // `bash` and `install_deps` are deliberately absent: neither can be
    // auto-approved without handing the model unprompted arbitrary shell. See
    // SUBPROCESS_TOOLS for why a fixed command is not enough to make one safe.
    if (FILE_TOOLS.includes(toolName) || VERSION_TOOLS.includes(toolName)) {
      return { behavior: 'allow' }
    }
    if (SUBPROCESS_TOOLS.includes(toolName)) {
      return { behavior: 'ask' }
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
 * Split a shell command into word-boundary-anchored tokens.
 *
 * Shared by {@link inspectCommand} and {@link describeNetworkUse} so both agree on
 * what counts as a word. Anchoring matters: without it `src/App.tsx` would match
 * its own `/App.tsx`, and a path like `./curly/x` would read as the `curl` command.
 *
 * @param command - The command string the model produced
 * @returns The command's tokens, in order
 */
function tokenizeCommand(command: string): string[] {
  return command.match(/(?<=^|[\s;|&(<>=])[^\s'"`;|&()<>]+/g) ?? []
}

/**
 * Describe any network access a shell command appears to make.
 *
 * **This never refuses anything, and it is not a control.** `bash` reaches the
 * network freely — `curl` was never in `BLOCKED_COMMANDS` — and under
 * `bypassPermissions` it still does, unwatched. All this adds is legibility: when
 * a `bash` call does reach the user for approval, the prompt can say why the
 * command deserves a second look. Like {@link inspectCommand} it is defeated by
 * variable expansion and substitution; do not describe it as enforcement.
 *
 * @param command - The command string the model produced
 * @returns A short phrase naming the network use, or null when none was spotted
 */
export function describeNetworkUse(command: string): string | null {
  const tokens = tokenizeCommand(command)

  for (const [index, token] of tokens.entries()) {
    // Match the executable name, tolerating a path prefix like `/usr/bin/curl`.
    const name = token.slice(token.lastIndexOf('/') + 1).toLowerCase()

    if (NETWORK_COMMANDS.includes(name)) {
      return `reaches the network (${name})`
    }

    // Git and package managers only reach the network for specific subcommands.
    const next = tokens[index + 1]?.toLowerCase()
    if (name === 'git' && next && ['push', 'pull', 'fetch', 'clone', 'remote'].includes(next)) {
      return `reaches the network (git ${next})`
    }
    if (
      ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'pip', 'pip3'].includes(name) &&
      next &&
      ['install', 'add', 'publish', 'update', 'upgrade', 'ci', 'create'].includes(next)
    ) {
      return `reaches the network (${name} ${next})`
    }
  }

  // A bare URL in the command is worth surfacing even if the verb went unrecognised.
  if (tokens.some((token) => /^https?:\/\//i.test(token))) {
    return 'reaches the network (URL)'
  }

  return null
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
  const tokens = tokenizeCommand(command)
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
  // Network tools carry a URL rather than a path. There is deliberately no host
  // policy — a fetch may reach loopback and the LAN — so this checks only that the
  // argument is a well-formed http(s) URL. It is the hook a host policy would use.
  if (NETWORK_TOOLS.includes(call.toolName)) {
    const url = call.input.url
    if (typeof url !== 'string') {
      return 'Invalid url'
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return `Not a valid URL: ${url}`
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Only http and https URLs can be fetched: ${url}`
    }
    return null
  }

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
