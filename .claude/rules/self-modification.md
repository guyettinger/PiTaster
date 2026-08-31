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

Also update the label maps in `ToolBubble.tsx` and the summary switch in
`InlineApproval.tsx`.

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
that way. `checkPermission` denies every tool under `plan` with exactly one
exception, `NETWORK_TOOLS`:

- `web_fetch` issues a GET with no request body. It cannot write a file, run a
  command, or modify the app, so it leaves the machine and the app as it found
  them — which is what `plan` promises. Letting the agent read documentation
  while planning is the point.

**The exception is not "it only reads".** The model controls the whole URL, so a
GET's path and query string are an egress channel: fetching
`https://elsewhere.example/?p=<something from context>` exfiltrates as
effectively as a POST would. With no host policy and no prompt in `plan` or
`acceptEdits`, nothing stops that. It is an accepted residual risk, mitigated
only by every call and its URL landing in the transcript where a person can see
it. Never restate the exception as "`web_fetch` cannot send data anywhere" — that
claim is false and must not be relied on as an invariant.

That exception is sound **only while the tool stays GET-only**. Adding a `method`
or `body` parameter to `web_fetch` invalidates the reasoning and must change
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

`agent/context-trim.ts` runs on Pi's `context` hook and rewrites the message list
before each provider request — truncating long tool results, collapsing repeated
reads, dropping stale screenshots. It is a token-budget optimization and nothing
more. It does not gate, filter, or redact anything for safety, and the untrimmed
conversation is still on disk in Pi's transcript. Never rely on it to keep
anything away from the model.

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
