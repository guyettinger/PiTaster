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

1. Registered — a `defineTool()` entry in `agent/version-tools.ts` (or Pi's
   built-in set) **and** its name in `AGENT_TOOL_NAMES` in `agent/session.ts`.
   Pi's `tools` option is an allowlist; an unlisted custom tool is silently
   dropped.
2. Classified in the permission gate (`FILE_TOOLS` or `VERSION_TOOLS`) so
   `acceptEdits` treats it deliberately.
3. Covered by `checkConfinement` if it takes a path or a command.
4. Covered by `auto-commit.ts` if it writes to the filesystem.

Also update the `## Available Tools` list in `agent/system-prompt.ts`, the label
maps in `ToolBubble.tsx`, and the summary switch in `InlineApproval.tsx`.

An unclassified tool falls through to `{ behavior: 'ask' }`. That is the safe
default — but a tool that reads or writes must be classified deliberately, not
left to fall through. Never add a tool to the `acceptEdits` allow-list that can
run arbitrary code; `bash` is deliberately absent.

## Permission Mode Enforcement

`plan` mode is read-only and must stay that way — `checkPermission` denies every
tool under `plan`, with no exceptions list. Denials are soft: the block reason
becomes the tool result and the agent continues, so the model can explain itself
rather than crashing.

## Writes Auto-Commit

`agent/auto-commit.ts` commits through `VersionManager`
(`packages/shared/src/versions/`) after every successful `write` or `edit`. This
is what makes every change rollback-able.

- It is a `tool_result` hook, not a property of the tools, so a write that does
  not reach the hook is not committed. Keep the `COMMITTING_TOOLS` set in step
  with any tool that can modify files.
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
