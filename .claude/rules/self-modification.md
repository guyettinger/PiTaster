---
paths:
  - "apps/electron/src/main/agent*.ts"
  - "packages/shared/src/versions/**/*.ts"
---

# Self-Modification Safety

This is the code that lets the agent rewrite its own source and the source of
sandboxed sub-apps. Every change here widens or narrows what the agent is
allowed to do to the machine. Treat additions to the tool surface as security
changes.

## Two Tool Families

Tools in `agent.ts` come in two sets, and they do **not** have the same
guarantees:

- **App-scoped tools** (`read_file`, `write_file`, …) operate on the active
  sub-app root and pass every path through `normalizePath(rootPath, path)`,
  which strips `..` segments and verifies the resolved path is still inside the
  root. Returns `null` on escape — always handle that branch.
- **Legacy tools** (`read_source`, `write_source`) resolve directly against
  `PROJECT_ROOT`. They exist for backward compatibility and are the app editing
  itself.

**Any new file tool must use the app-scoped pattern.** Do not add tools that
resolve a caller-supplied path without normalization.

## Adding a Tool

Every new tool needs all four, or it is a hole:

1. A schema entry in the tool definition list
2. A `case` in the execution switch
3. Classification in the permission gate (`scopedFileTools`, `scopedVersionTools`,
   or the equivalent) so `acceptEdits` and `plan` treat it correctly
4. Path normalization and/or command blocklisting, if it touches the filesystem
   or a shell

A tool that is not classified in the permission gate falls through to
`{ behavior: 'ask' }`. That is the safe default — but a tool that reads or
writes must be classified deliberately, not left to fall through.

## Permission Mode Enforcement

`plan` mode is read-only and must stay that way. No tool that mutates the
filesystem, runs a command, or changes git state may execute under `plan`:

```typescript
function checkWritePermission(permissionMode: PermissionMode): void {
  if (permissionMode === 'plan') {
    throw new Error('Cannot modify files in plan mode')
  }
}
```

## Shell Commands

Commands are checked against `BLOCKED_COMMANDS` before execution. When adding a
tool that shells out, extend that list rather than adding an ad-hoc check, so
there is one place to audit.

## Writes Auto-Commit

`write_source` and the scoped write tools commit through `VersionManager`
(`packages/shared/src/versions/`) immediately after writing. This is what makes
every change rollback-able, and it is the reason the agent can safely modify
itself.

- The commit is best-effort: a git failure must not lose the write, but it must
  be reported so the user knows the change is uncommitted.
- Never batch or defer commits — one write, one commit, so history stays
  granular enough to roll back precisely.

## Verify Before Declaring Success

After modifying source, run the type check and report the real result:

```bash
bun run typecheck:all
```

If it fails, fix it or roll back — do not report success. `version_rollback` /
`rollback` restores any prior commit.

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
