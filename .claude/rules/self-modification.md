---
paths:
  - "apps/electron/src/main/agent/**/*.ts"
  - "apps/electron/src/main/agent-utils.ts"
  - "packages/shared/src/versions/**/*.ts"
---

# Self-Modification Safety

This is the code that lets the agent rewrite the source of sandboxed sub-apps.
Every change here widens or narrows what the agent is allowed to do to the
machine. Treat additions to the tool surface as security changes.

## Pi Ships No Sandbox

The agent is Pi (`@earendil-works/pi-coding-agent`). Its built-in tools — `read`,
`write`, `edit`, `bash`, `grep`, `find`, `ls` — run with the permissions of the
Electron main process. Pi's `resolveToCwd` expands `~`, strips a leading `@`, and
resolves against the working directory, but performs **no containment check**: an
absolute path passes straight through.

Confinement therefore lives entirely in the `tool_call` handler in
`agent/permission-gate.ts`. That handler is the only boundary between the model
and the filesystem. A bug in it is a full escape.

- **Path arguments** (`path`, on every path-bearing built-in) are resolved with
  `resolveLikePi` — which must keep matching Pi's own resolution — and rejected by
  `isWithinRoot` if they land outside the sub-app root.
- **Shell commands** are checked against `BLOCKED_COMMANDS` and scanned for
  literal out-of-root paths, absolute, `~`-rooted, and relative (`../..`).
  This is best-effort, not confinement: variable expansion (`ls $HOME`) and
  command substitution defeat it. Do not describe it as a sandbox.
- **Quoted paths need their own pass.** `tokenizeCommand` excludes quote characters
  from a token and requires one to begin at an unquoted word boundary, so nothing
  inside `"..."` or `'...'` reaches the scan — `cat "/etc/passwd"` was allowed for as
  long as that was the only pass. `quotedRootedPaths` covers the absolute and
  `~`-rooted case; a quoted *traversal* is deliberately still ignored, because a
  quoted `../` is usually a grep pattern and refusing it would be a false refusal of
  exactly the kind `2>/dev/null` was. Any new scan added here has to ask the same
  question: does the tokenizer even see the thing being checked?
- **Some paths outside the root are exempt from that scan, in three classes.**
  Matching is always on a path boundary, never a bare `startsWith` — `/usr/binaries`
  and `/tmpfoo` must stay refused.
  - `SHELL_READONLY_PREFIXES` — root-owned and SIP-sealed. Naming them grants
    nothing `bash` could not do by bare command name, because writing to them needs
    privileges the process does not have and `sudo` is blocked.
  - `SHELL_TOOLCHAIN_PREFIXES` (`/usr/local`, `/opt/homebrew`) — **named but never
    written to**, and `inspectToolchainWrites` enforces that. These break the
    justification above: Apple excludes `/usr/local` from SIP and `/opt/homebrew` is
    the Apple Silicon Homebrew prefix, so both are user-writable *and* on the PATH
    every other program on the machine uses. A bare command name can run `git`; it
    can never overwrite the `git` on the user's PATH. Only an absolute path can, and
    that is a persistent backdoor outside the sub-app.
  - `SHELL_SCRATCH_PREFIXES` — the temp directories, writable, because a model that
    can already write and run a script in the app root gains nothing from `/tmp`.
  - `SHELL_SAFE_DEVICES` — matched exactly. `inspectDeviceRedirects` refuses a write
    into `/dev/` for anything else; it replaced a `'> /dev'` substring entry which
    also refused `> /dev/null`.

  **Adding an entry needs both tests, not one.** "Does naming it grant anything
  `bash` could not already do by bare command name" licenses the read-only list — and
  it silently fails for *writes* into a writable directory, which is how
  `/opt/homebrew` first landed in the wrong class. Ask separately: is it writable,
  and is anything on it on the user's `PATH`?

If you change how Pi resolves paths, or upgrade Pi across a version that changes
it, `resolveLikePi` must be revisited.

## Adding a Tool

Every new tool needs all four, or it is a hole:

1. Registered — a `defineTool()` entry in `agent/version-tools.ts`,
   `agent/web-tools.ts`, or Pi's built-in set, **and** its name in
   `AGENT_TOOL_NAMES` in `agent/session.ts`.
   Pi's `tools` option is an allowlist; an unlisted custom tool is silently
   dropped. `resolveToolNames` may then *remove* names from that list for the
   lean profile — it never adds any, so a tool the gate has not classified can
   never reach the model through it.
2. Classified in the permission gate (`FILE_TOOLS`, `VERSION_TOOLS`,
   `SUBPROCESS_TOOLS`, or `NETWORK_TOOLS`) so `acceptEdits` treats it
   deliberately. `NETWORK_TOOLS` also grants `plan` access — see below.
3. Covered by `checkConfinement` if it takes a path, a command, or a URL.
4. Covered by `auto-commit.ts` if it writes to the filesystem.

Also update the label maps in `ToolBubble.tsx` and the summary switches in
`InlineApproval.tsx` and `ApprovalRecord.tsx`.

`replace_lines` is the worked example: `FILE_TOOL_NAMES` into `AGENT_TOOL_NAMES`,
`PATH_TOOLS` and `FILE_TOOLS` in the gate, `COMMITTING_TOOLS` in `auto-commit.ts`,
and three label maps. A tool that resolves its own paths — as it does, with
`resolve(rootPath, path)` — must resolve them the way `resolveLikePi` does, or the
gate is checking a different path from the one the tool writes.

The system prompt deliberately does **not** list the tools. Pi already puts every
tool's name, description and JSON schema in the function-calling payload, so a
prompt list was a duplicate paid for on every request — and one that silently
drifted out of step. Do not reintroduce it.

An unclassified tool falls through to `{ behavior: 'ask' }`. That is the safe
default — but a tool that reads or writes must be classified deliberately, not
left to fall through. Never add a tool to the `acceptEdits` allow-list that can
run arbitrary code; `bash` and `install_deps` are deliberately absent.

**A fixed command is not enough to make a tool safe.** `install_deps` runs only
`bun install` and takes no parameters, which reads as safe and is not: `bun`
executes the project's own `preinstall`/`postinstall` scripts, and `acceptEdits`
already lets the model write `package.json` without asking. Two auto-approved
steps compose into unprompted arbitrary shell. Before auto-approving any tool
that spawns a process, ask what that process reads from files the model can
write.

## Permission Mode Enforcement

`plan` mode means **no side effects on the machine or the app**, and must stay
that way. It does *not* mean "no activity": `checkPermission` allows
`PLAN_READ_TOOLS` and `NETWORK_TOOLS` under `plan`, and denies everything else.

- `PLAN_READ_TOOLS` inspect and cannot change anything: `read`, `grep`, `find`,
  `ls`, `load_skill`, `git_status`, `get_history`, `list_branches`. Argue any
  addition individually — `create_branch`, `switch_branch` and `rollback` are
  absent because they move HEAD, which changes the app even though nothing is
  written, and `bash` is absent because it is not a read tool however read-only
  the command looks.
- `web_fetch` issues a GET with no request body. It cannot write a file, run a
  command, or modify the app, so it leaves the machine and the app as it found
  them — which is what `plan` promises. Letting the agent read documentation
  while planning is the point.

An unclassified tool still falls through to a denial under `plan`, so a tool
added later cannot inherit read access by being forgotten.

**`web_fetch` is not "it only reads".** The model controls the whole URL, so a
GET's path and query string are an egress channel: fetching
`https://elsewhere.example/?p=<something from context>` exfiltrates as
effectively as a POST would. With no host policy and no prompt in `plan` or
`acceptEdits`, nothing stops that — and now that `plan` reads files, the two
compose: read a file, put it in a query string, two ordinary-looking tool calls.
Allowing reads widened an already-accepted risk rather than creating a new class
of one. It stays bounded by the app root and mitigated only by every call and its
URL landing in the transcript where a person can see it. A host allowlist on
`web_fetch` is what would close it.

Never restate this as "`web_fetch` cannot send data anywhere" — that claim is
false and must not be relied on as an invariant.

The `web_fetch` allowance is sound **only while the tool stays GET-only**. Adding
a `method` or `body` parameter to `web_fetch` invalidates the reasoning and must change
`checkPermission` in the same commit. Do not add a second entry to
`NETWORK_TOOLS` without the same analysis: "it only reads" is not enough, the
test is whether the call can change anything anywhere.

Denials are soft: the block reason becomes the tool result and the agent
continues, so the model can explain itself rather than crashing.

## The Loop Guard Only Narrows

`agent/loop-guard.ts` refuses a third consecutive identical call, on the same
`tool_call` handler as the gate. It runs *after* `checkConfinement` and can only
refuse a call that would otherwise have been allowed — it never approves one, and
it never sees a call the gate has already blocked. Keep it that way: anything in
that handler that can turn a denial into an approval is a security bug.

Its refusal is soft, like every other, so the model is told to change approach
rather than crashed.

## Network Access Is Not Confined

There is deliberately **no host policy**. `web_fetch` can reach `localhost`
(including the Ollama daemon on 11434), the LAN, and link-local metadata
addresses. `checkConfinement` validates only that the URL is well-formed
`http(s)`; it is the hook a policy would use if one is ever wanted.

`bash` reaches the network too, and always has — `curl` and `wget` were never in
`BLOCKED_COMMANDS`, and `inspectCommand` only scans for filesystem paths.
`describeNetworkUse` annotates such commands so the approval prompt can say why
one matters, but it **refuses nothing** and is defeated by variable expansion
like every other shell scan here. Do not describe it as a control.

## Context Shaping Is Not Confinement

`agent/context-trim.ts` truncates long tool results, collapses reads a later read
has fully covered, and drops stale screenshots. It is a token-budget optimization
and nothing more. It does not gate, filter, or redact anything for safety, and the
untrimmed conversation is still on disk in Pi's transcript. Never rely on it to
keep anything away from the model.

It **mutates Pi's stored messages**, which is unusual enough to state plainly: a
seal is permanent, because Pi's compaction check estimates over
`agent.state.messages` and a trim it cannot see relieves nothing. That makes the
JSONL transcript the only remaining copy of the full text, so the rules below are
about data, not tokens.

It is also not a bound on a tool's output. The hook shapes what is *sent*; the
full result is still written to the transcript, and any tool left out of
`TRUNCATABLE_TOOLS` is untouched. A tool that can produce unbounded output has to
bound it itself — `git_status` caps its path listing and `get_history` clamps the
count the model asks for, because relying on the trimmer would leave the defect
in place everywhere the trimmer does not reach.

Four rules the trimmer must keep, the first two of which have been broken before:

- **Superseding compares regions, not paths.** Pi's `read` pages a large file with
  `offset`, so two reads of one path are usually two different parts of it.
  Collapsing on the path alone deletes content the model believes it still has.
- **Never silently drop a resume pointer.** Pi's read output has no line numbers;
  its `[Showing lines X-Y of Z. Use offset=N to continue.]` footer is the only
  thing telling the agent where it got to, and it is the last line — exactly what
  a head-slice removes. Recompute it for the shortened body, never just cut it.
- **The seal never reaches into the current turn.** `SessionManager` writes a
  message's transcript entry when the message is appended, so mutating anything
  older cannot rewrite what is already on disk. Sealing a message whose entry has
  not been written yet would put the trimmed text into the transcript — destroying
  the only full copy, silently, and with it the History panel's record of what the
  agent actually saw.
- **Never flatten content that carries an image.** The seal writes over the
  original, so replacing a result's blocks with one text block destroys an image
  permanently rather than for one request. No truncatable tool returns one today;
  the guard is what keeps that from becoming data loss the day one does.

## The Edit-Repair Hook Only Explains

`agent/edit-repair.ts` runs on the same `tool_result` hook as auto-commit and rewrites
a failed `edit`'s message into one the model can act on — the file's real text for the
region it was aiming at, with line numbers.

Three rules it must keep:

- **Never flip `isError` to false.** Pi's `ToolResultEventResult` allows it, and doing
  so would tell the model a change landed when the file is untouched.
- **Stay bounded.** It quotes file contents into a tool result on a window as small as
  32k. The budget comes from `ContextBudget.maxToolResultTokens`; an unbounded quote
  would cost more than the failure it explains.
- **It runs before auto-commit and must stay ordered that way** — harmlessly, because a
  failed edit never commits. Do not let it swallow the auto-commit note on a *successful*
  result.

Its per-path failure counter is not a gate. It escalates by telling the model to change
tools; it never blocks an edit, because a model with no way to change the file is worse
than one editing badly.

## Skills Are Instructions the Agent Can Write

`load_skill` returns a skill's body as a tool result, and the system prompt tells the
model to follow it. The agent can also *write* a skill, into `<app-root>/skills/`, which
is inside what `acceptEdits` auto-approves. So a skill is the one place where text the
agent produced in one session becomes an instruction it is told to obey in the next.

Two rules follow, and the first was a real hole:

- **A skill's identity is its directory name, never its frontmatter `name:`.** Trusting
  the frontmatter let any file declare itself `manage-versions`, shadow the real one, and
  be returned by `load_skill` under that name. A directory entry cannot contain a
  separator and cannot be forged from inside a file. `toSkill` in
  `packages/shared/src/skills/loader.ts` keys on the directory; keep it that way.
- **`load_skill` takes a name, never a path**, and resolves it against a list built at
  session start from the two known roots. That is why it is not in `PATH_TOOLS` and why
  `checkConfinement` has nothing to check — not an omission. A `path` parameter would
  make it a path tool and would have to be gated like one.

The residual risk — a planted instruction persisting across sessions — is accepted, and
mitigated only by every write and every load appearing in the transcript. Do not describe
skill content as trusted.

## Writes Auto-Commit

`agent/auto-commit.ts` commits through `VersionManager`
(`packages/shared/src/versions/`) after every successful `write` or `edit`. This
is what makes every change rollback-able.

- It is a `tool_result` hook, not a property of the tools, so a write that does
  not reach the hook is not committed. Keep the `COMMITTING_TOOLS` set in step
  with any tool that can modify files.
- The hook keys on `input.path`, so a tool that writes files without a `path`
  argument can never reach it. `install_deps` is the case in point: it takes no
  parameters but `bun install` rewrites the lockfile, so it calls
  `autoCommitInstallArtifacts` itself. A tool in that shape must commit its own
  output, or `rollback` silently leaves that file behind — `git checkout` does
  not remove uncommitted files.
- A git failure must not lose the write, but it must be reported — the handler
  appends the failure to the tool result so the model and the user both see that
  the change is uncommitted.
- Never batch or defer commits — one write, one commit, so history stays granular
  enough to roll back precisely.
- The `autoCommit` setting gates this. When it is off, writes are intentionally
  uncommitted; do not work around it.

## Verify Before Declaring Success

After modifying source, run the type check and report the real result:

```bash
bun run typecheck:all
```

If it fails, fix it or roll back — do not report success. The `rollback` tool
restores any prior commit.

## Restart Safety

Changes to `src/main/` require an app restart to take effect. Always confirm
with the user before restarting; never relaunch unprompted:

```typescript
const confirmed = await dialog.showMessageBox({
  type: 'question',
  buttons: ['Restart', 'Cancel'],
  message: 'App needs to restart to apply changes. Restart now?'
})

if (confirmed.response === 0) {
  app.relaunch()
  app.exit(0)
}
```
