/**
 * Permission gating and path confinement for Pi's tools.
 *
 * Pi ships no sandbox: its built-in `read`, `write`, `edit`, and `bash` tools run with
 * the permissions of the host process, and `resolveToCwd` expands `~` and passes
 * absolute paths straight through without a containment check. Adopting those tools
 * therefore moves Key Lime Pi's confinement out of the tools and into this handler.
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
 * The shell scan permits a named set of locations outside the root — the harmless
 * device files, the read-only toolchain directories, and the OS temp directory. That
 * is a widening of the *scan*, not of what `bash` can do: the shell resolves bare
 * command names through `PATH` regardless, so refusing the token `/usr/bin/sed` only
 * ever punished the model for spelling out a path it did not need to spell. Refusing
 * `2>/dev/null` was the same mistake with a worse symptom, because discarding output
 * is something a model writes reflexively. See {@link SHELL_READONLY_PREFIXES}, and
 * {@link SHELL_TOOLCHAIN_PREFIXES} for the two paths that may be named but not written.
 *
 * MCP source tools are the one part of the surface {@link checkConfinement} cannot
 * police. They carry no path Key Lime Pi resolved, they execute inside a separate server
 * process the user configured, and their reach is whatever that server exposes.
 * Approval is their entire boundary, which is why {@link checkPermission} never
 * auto-approves one outside `bypassPermissions`.
 */

import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { PermissionMode } from '@keylimepi/core'
import { isMcpToolName } from './mcp-tools'

/**
 * Shell command patterns that are refused outright, in every permission mode.
 * Ported verbatim from the pre-Pi `run_command` tool.
 */
const BLOCKED_COMMANDS = ['rm -rf /', 'sudo', 'dd if=', 'mkfs', ':(){']

/**
 * Device files a shell command may redirect to.
 *
 * Discarding output is ordinary: `bun run build 2>/dev/null` is a command a model
 * writes without thinking about it, and both halves of this module used to refuse it —
 * the token scan because `/dev/null` is outside the app root, and a `'> /dev'` entry in
 * {@link BLOCKED_COMMANDS} that was aimed at block devices and caught the null device
 * with them. Writing to these four changes nothing on the machine, which is the test
 * that matters; `> /dev/disk0` still does, and is still refused by
 * {@link inspectDeviceRedirects}.
 */
const SHELL_SAFE_DEVICES = new Set([
  '/dev/null',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
  '/dev/zero'
])

/**
 * Locations outside the app root a shell command may name for reading or execution.
 *
 * **This widens a scan, not a sandbox, and it grants no capability the shell did not
 * already have.** `bash` resolves bare command names through `PATH` and always could:
 * refusing the token `/usr/bin/sed` never stopped `sed`, it only made the model's
 * spelling of it decide whether the call ran.
 *
 * Everything here is root-owned and, on macOS, SIP-sealed — writing to it needs
 * privileges this process does not have and `sudo` cannot supply, since `sudo` is in
 * {@link BLOCKED_COMMANDS}. That is what makes "may name" and "may not harm" the same
 * statement for these paths, and it is why {@link SHELL_TOOLCHAIN_PREFIXES} is a separate
 * list.
 */
const SHELL_READONLY_PREFIXES = [
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/libexec',
  '/usr/share',
  '/System/Library',
  '/Library/Developer'
]

/**
 * Toolchain locations that may be named but never written to.
 *
 * These are the Homebrew prefixes, and they are the exception that breaks the reasoning
 * above. Apple excludes `/usr/local` from System Integrity Protection, and
 * `/opt/homebrew` is the Apple Silicon Homebrew prefix — **both are writable by the user
 * without `sudo`, and both sit early on the shell `PATH` that every other terminal and
 * app on the machine uses.** So the test that licenses the read-only list fails here in
 * one direction: a bare command name can run `git`, but it can never *overwrite* the
 * `git` on the user's `PATH`. Only spelling the absolute path can, and that is a
 * persistent backdoor outside the sub-app, surviving in every future shell.
 *
 * Naming them is still worth allowing — `/opt/homebrew/bin/bun install` is an ordinary
 * command — so they are exempt from the path scan and then policed by
 * {@link inspectToolchainWrites}, which refuses any command that would write into them.
 */
const SHELL_TOOLCHAIN_PREFIXES = ['/usr/local', '/opt/homebrew']

/**
 * Scratch locations a command may both name and write to.
 *
 * Writing here is not an escalation: a model that can already write and execute a script
 * inside the app root gains nothing from writing one in the temp directory, and nothing
 * on `PATH` lives here for it to shadow.
 *
 * macOS resolves the temp directory under `/private`, and `tmpdir()` returns the
 * unresolved form, so both are listed.
 */
const SHELL_SCRATCH_PREFIXES = [
  '/tmp',
  '/private/tmp',
  '/var/folders',
  '/private/var/folders',
  tmpdir()
]

/**
 * Commands that write to a file named in their arguments.
 *
 * Used only by {@link inspectToolchainWrites}, and deliberately broad: the cost of a
 * false positive is one refused command inside `/usr/local`, which a sub-app build has no
 * reason to touch, while the cost of a false negative is a binary on the user's `PATH`
 * replaced.
 */
const FILE_WRITING_COMMANDS = [
  'cp',
  'mv',
  'tee',
  'install',
  'ln',
  'rm',
  'rmdir',
  'dd',
  'truncate',
  'touch',
  'chmod',
  'chown',
  'mkdir',
  'patch',
  'unzip',
  'tar',
  'curl',
  'wget'
]

/**
 * Tools whose arguments include a filesystem `path`.
 *
 * Every path-bearing built-in uses that same key, and so do `replace_lines`,
 * `code_intel` and `refactor`.
 *
 * For the last two this check is necessary and **not sufficient**, which is worth being
 * precise about. It confines the one path the model names. It says nothing about the
 * paths the *compiler* names back — a rename's edit list, a `references` result — which
 * module resolution can carry outside the root. Those are confined in `ts-service/` and
 * re-checked in `code-tools.ts` before any write. See the module comment there.
 */
const PATH_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'replace_lines',
  'grep',
  'find',
  'ls',
  'code_intel',
  'refactor'
])

/**
 * Tools allowed in `plan` mode: they inspect, and cannot change anything.
 *
 * `plan` promises "no side effects", not "no activity" — and the mode is called
 * *Explore* in the UI, whose hint has always read "Reads files. Changes nothing." The
 * code did not agree: `plan` denied every tool but `web_fetch`, so the one mode meant for
 * reading a codebase was the only one that could not read it.
 *
 * Each entry is argued individually, not assumed from its name. These read a file inside
 * the app root (`read`, `grep`, `find`, `ls`), read a skill the user already put in their
 * own library (`load_skill`), or read git state without touching the working tree
 * (`git_status`, `get_history`, `list_branches`). `create_branch`, `switch_branch` and
 * `rollback` are deliberately absent: they move HEAD, which changes the app even though
 * nothing is "written". `bash` is absent for the obvious reason — it is not a read tool
 * however read-only the command looks, because the scan that would decide that is
 * best-effort.
 *
 * **Reads compose with `web_fetch` into an unprompted egress path.** Both are allowed
 * here without a prompt, the model controls the whole URL, and there is no host policy —
 * so in `plan` the agent can read a file and put its contents in a query string, with the
 * user seeing two ordinary-looking tool calls. That risk was already accepted and
 * documented for `web_fetch`; this widens what is reachable through it from "whatever is
 * already in context" to "any file in the app root". It stays bounded by the app root and
 * visible in the transcript, which is the whole mitigation. A host allowlist on
 * `web_fetch` is the thing that would close it.
 */
const PLAN_READ_TOOLS = [
  'read',
  'grep',
  'find',
  'ls',
  'load_skill',
  'git_status',
  'get_history',
  'list_branches',
  // `code_intel` only asks the compiler questions — outline, definition, references,
  // hover, and one declaration's source. Every one of them is a read of a file the mode
  // already permits reading, answered more precisely. `refactor` is deliberately absent:
  // it writes, and `plan` refuses it for the same reason it refuses `create_branch`.
  'code_intel'
]

/**
 * Tools auto-approved in `acceptEdits` mode: reads and writes within the app root.
 *
 * `load_skill` is here rather than in {@link PATH_TOOLS} because it takes a skill
 * *name*, not a path — there is no argument for {@link checkConfinement} to resolve, and
 * no way to spell one that reaches another file. It is classified with `read` because
 * that is what it does: open one file the user put in their own skills directory. It is
 * the tool that replaced pointing the model at that file's path and having the gate
 * refuse it, so treating it more strictly than `read` would restore the original bug.
 */
const FILE_TOOLS = [
  'read',
  'write',
  'edit',
  'replace_lines',
  'grep',
  'find',
  'ls',
  'load_skill',
  'code_intel',
  // `refactor` writes, so it belongs with `write` and `edit` rather than with the reads
  // — and for the same reason it is auto-approved here. Its writes are auto-committed
  // together and computed by the compiler rather than guessed at. Auto-approving it rests
  // on its writes staying inside the app root, which is enforced in `code-tools.ts` at the
  // point of each write rather than by this table: the compiler can name a path the model
  // never did, and this classification is what makes that unprompted.
  'refactor'
]

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
 * `plan` allows {@link NETWORK_TOOLS} and {@link PLAN_READ_TOOLS}, and denies everything
 * else. None of them can write a file, run a command, or modify the app, so they leave
 * the machine and the app as they found them, which is what `plan` promises. Letting the
 * agent read the code and the docs while planning is the point — a mode that could not
 * do that was useless for the one job it has. The `web_fetch` exception is checked before
 * the `plan` branch and is sound only while that tool stays GET-only.
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
  // Checked before the `plan` branch: a GET changes nothing, so it is treated like
  // `read` and runs free everywhere except `default`, which prompts for every tool by
  // design. Note this is not the same as sending nothing — see the module note.
  if (NETWORK_TOOLS.includes(toolName)) {
    return permissionMode === 'default' ? { behavior: 'ask' } : { behavior: 'allow' }
  }

  if (permissionMode === 'plan') {
    if (PLAN_READ_TOOLS.includes(toolName)) {
      return { behavior: 'allow' }
    }
    return {
      behavior: 'deny',
      message:
        'Explore mode is active. You can read files, search, inspect git history and fetch URLs, but nothing may change. Say what you would do instead, and let the user switch modes.'
    }
  }

  if (permissionMode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }

  // MCP tools reach outside the app root into a process Key Lime Pi does not control,
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
 * Absolute and home-rooted paths that appear inside quotes.
 *
 * {@link tokenizeCommand} excludes quote characters from a token *and* requires a token
 * to begin at an unquoted word boundary, so nothing inside `"..."` or `'...'` was ever
 * scanned — `cat "/etc/passwd"` passed, and so did `> "/dev/disk0"`. That predates the
 * safe-path list; it is a hole in the tokenizer, not in the exemptions.
 *
 * Only *rooted* quoted values are returned. A quoted value containing a traversal is
 * deliberately left alone: a quoted `../` is usually a grep pattern rather than a path,
 * and refusing it would be the same class of false refusal as refusing `2>/dev/null`. An
 * absolute path in quotes has no such innocent reading.
 *
 * @param command - The command string the model produced
 * @returns The quoted values that name an absolute or `~`-rooted path
 */
function quotedRootedPaths(command: string): string[] {
  const quoted = command.matchAll(/"([^"]*)"|'([^']*)'/g)
  const paths: string[] = []

  for (const match of quoted) {
    const value = (match[1] ?? match[2] ?? '').trim()
    if (value.startsWith('/') || value.startsWith('~')) {
      paths.push(value)
    }
  }

  return paths
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
 * Explain a path refusal in a way the model can act on.
 *
 * This string is the model's entire feedback: a blocked call becomes the tool result
 * and the run continues. Naming the offending path and stopping there produced the
 * observed failure mode — the model re-issues a near-identical path — so the reason
 * says where it may work instead.
 *
 * @param path - The path as the model wrote it
 * @returns The refusal reason
 */
function outOfBoundsReason(path: string): string {
  return (
    `Path outside the app directory: ${path}. Work inside the app directory instead — ` +
    'paths are relative to its root, and you cannot read or write above it.'
  )
}

/**
 * Whether a shell token names a location the scan deliberately permits.
 *
 * Exact match for the device files, prefix match on a path boundary for the rest — a
 * bare `startsWith` would accept `/usr/binaries` and `/tmpfoo` on the strength of a
 * shared prefix, which is the same mistake {@link isWithinRoot} exists to avoid.
 *
 * @param absolutePath - The token, resolved the way Pi will resolve it
 * @returns True when the token may be named despite lying outside the app root
 */
function isShellSafePath(absolutePath: string): boolean {
  if (SHELL_SAFE_DEVICES.has(absolutePath)) return true

  return [
    ...SHELL_READONLY_PREFIXES,
    ...SHELL_TOOLCHAIN_PREFIXES,
    ...SHELL_SCRATCH_PREFIXES
  ].some((prefix) => absolutePath === prefix || absolutePath.startsWith(`${prefix}/`))
}

/**
 * Whether a path lies under a writable toolchain prefix.
 * @param absolutePath - The token, resolved the way Pi will resolve it
 * @returns True when writing to it would alter the machine's `PATH`
 */
function isToolchainPath(absolutePath: string): boolean {
  return SHELL_TOOLCHAIN_PREFIXES.some(
    (prefix) => absolutePath === prefix || absolutePath.startsWith(`${prefix}/`)
  )
}

/**
 * The tokens that sit in a command position.
 *
 * A pipeline or a `;`-separated list has several. Taking only the very first token misses
 * `cmd | tee /opt/homebrew/bin/x`; taking *every* token instead reads `bun install` as the
 * `install` command, which refused `/opt/homebrew/bin/bun install` — an ordinary command
 * and exactly the kind of false refusal this session set out to remove. So the segments
 * are split on shell separators and only each segment's leading word is considered.
 *
 * Leading environment assignments are skipped, since `FOO=1 cp …` puts `cp` in the
 * command position. Wrappers that take a command as an argument — `env`, `xargs`, `nohup`
 * — are not followed; like every scan here this is best-effort, and `bash` is never
 * auto-approved outside `bypassPermissions`.
 *
 * @param command - The command string the model produced
 * @returns The lowercased basenames of the tokens in a command position
 */
function commandPositionNames(command: string): string[] {
  const names: string[] = []

  for (const segment of command.split(/[;|&\n()]+/)) {
    const words = segment.trim().split(/\s+/).filter((word) => word.length > 0)
    // `FOO=1 BAR=2 cp …` — the command is the first word that is not an assignment.
    const leading = words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
    if (leading === undefined) continue
    names.push(leading.slice(leading.lastIndexOf('/') + 1).toLowerCase())
  }

  return names
}

/**
 * Refuse a command that would write into a writable toolchain prefix.
 *
 * {@link SHELL_TOOLCHAIN_PREFIXES} explains why these two paths need naming but not
 * writing. This catches the two shapes a write takes: a redirect target, and an argument
 * to a command that writes the files it is given.
 *
 * The command-name test uses {@link commandPositionNames}, so each stage of a pipeline is
 * checked but a subcommand is not mistaken for a command.
 *
 * Like every scan here it is best-effort and defeated by variable expansion. It narrows
 * an exemption; it is not a control on its own.
 *
 * @param command - The command string the model produced
 * @param rootPath - The sub-app root
 * @returns A refusal reason, or null when no toolchain write was found
 */
function inspectToolchainWrites(command: string, rootPath: string): string | null {
  const tokens = [...tokenizeCommand(command), ...quotedRootedPaths(command)]
  const toolchainTokens = tokens.filter((token) =>
    isToolchainPath(resolveLikePi(token, rootPath))
  )
  if (toolchainTokens.length === 0) return null

  // A redirect into one of them, in any of the forms a shell accepts.
  const redirected = new Set<string>()
  for (const match of command.matchAll(/\d*>>?\|?\s*['"]?([^\s'"`;|&()<>]+)/g)) {
    redirected.add(match[1])
  }

  for (const token of toolchainTokens) {
    if (redirected.has(token)) {
      return toolchainWriteReason(token)
    }
  }

  const writesFiles = commandPositionNames(command).some((name) =>
    FILE_WRITING_COMMANDS.includes(name)
  )
  if (writesFiles) {
    return toolchainWriteReason(toolchainTokens[0])
  }

  return null
}

/**
 * Explain a refused toolchain write.
 * @param path - The offending path
 * @returns The refusal reason
 */
function toolchainWriteReason(path: string): string {
  return (
    `Refusing to write to ${path}. That directory is on the machine's PATH and is shared ` +
    'with every other program on it — you may run programs from there, but not modify ' +
    'them. Write inside the app directory instead.'
  )
}

/**
 * Refuse a redirect that writes to a device other than the harmless ones.
 *
 * This replaces the old `'> /dev'` entry in {@link BLOCKED_COMMANDS}, which was a
 * substring test and so refused `> /dev/null` along with `> /dev/disk0`. Matching the
 * redirect operator rather than the bare path keeps the block aimed at writes: naming
 * `/dev/urandom` as an *input* was never the concern.
 *
 * @param command - The command string the model produced
 * @returns A refusal reason, or null when no unsafe device write was found
 */
function inspectDeviceRedirects(command: string): string | null {
  // The target may be quoted. `tokenizeCommand` cannot see inside quotes, and the
  // substring blocklist this replaced could not either — `> "/dev/disk0"` slipped past
  // both. Optional quotes here are the cheap half of closing that; the other half is
  // {@link quotedRootedPaths}.
  const redirects = command.matchAll(/\d*>>?\s*['"]?(\/dev\/[^\s'"`;|&()<>]*)/g)

  for (const redirect of redirects) {
    const target = redirect[1]
    if (!SHELL_SAFE_DEVICES.has(target)) {
      return `Refusing to write to the device ${target}. Only /dev/null, /dev/stdout, /dev/stderr, /dev/tty and /dev/zero may be redirected to.`
    }
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
 * {@link isShellSafePath}'s prefixes and {@link SHELL_SAFE_DEVICES} are skipped. That widens
 * what the scan tolerates without widening what `bash` can do — see the note on those
 * constants.
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

  const deviceWrite = inspectDeviceRedirects(command)
  if (deviceWrite) return deviceWrite

  const toolchainWrite = inspectToolchainWrites(command, rootPath)
  if (toolchainWrite) return toolchainWrite

  // Flag literal paths that point outside the app root. Tokens must start at a
  // shell word boundary, or `src/App.tsx` would match its own `/App.tsx`.
  //
  // Both absolute/home-relative tokens (`/etc/passwd`, `~/.ssh/id_rsa`) and
  // relative traversals (`../..`) are checked. The traversal case is not
  // hypothetical: a model refused by the `ls` tool will reach for `bash ls ../..`
  // as its next move.
  const tokens = [...tokenizeCommand(command), ...quotedRootedPaths(command)]
  for (const token of tokens) {
    const isRooted = token.startsWith('/') || token.startsWith('~')
    const hasTraversal = token === '..' || /(?:^|\/)\.\.(?:\/|$)/.test(token)
    if (!isRooted && !hasTraversal) continue

    const resolved = resolveLikePi(token, rootPath)
    if (isShellSafePath(resolved)) continue

    if (!isWithinRoot(rootPath, resolved)) {
      return outOfBoundsReason(token)
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
      return outOfBoundsReason(path)
    }
  }

  return null
}
