# Session 20 Notes: The Editing Loop

**Date**: 2026-08-31
**Status**: ✅ Complete

## What Was Built

The agent can now edit an indented block without whitespace roulette, recovers from
the edits it does fail, and can redirect a shell command to `/dev/null`. Four of the
six changes were bug fixes rather than features — including the one that mattered most,
which had been silently true since Pi was adopted.

Verified live against `qwen3.8:27b-mlx` on Ollama: `bun --version 2>/dev/null` ran
(it used to return `Path outside the app directory: /dev/null`), the model read
`README.md` and then edited it with `replace_lines`, the tool bubble rendered
`Replace lines · README.md:1-1`, and auto-commit produced
`replace_lines: README.md`. Deleting `~/.pitaster/skills` and relaunching reinstated all
eight skills.

### Components Created

1. **`agent/tool-guidance.ts`** — recovers Pi's per-tool `promptGuidelines`
   - Read off Pi's live `create*ToolDefinition` output, never copied
   - Selected by the session's resolved tool list, deduped, stable order

2. **`agent/edit-repair.ts`** — `tool_result` hook, turns a failed `edit` into the
   file's real text at real line numbers, and escalates a per-path failure streak

3. **`agent/file-tools.ts`** — `replace_lines`, editing by line number

4. **`agent/file-lines.ts`** — the line splitting, joining and numbering both share

5. **`agent/context-files.ts`** — `agentsFilesOverride`, dropping the `AGENTS.md`
   ancestry above the sub-app

6. **`packages/shared/src/skills/seed{,-content}.ts`** — the seed skills, installed on
   first run

### Changed

- `agent/system-prompt.ts` — the guidance block plus an `## Editing Files` section;
  ~430 → ~757 tokens
- `agent/permission-gate.ts` — `SHELL_SAFE_DEVICES` plus three prefix classes,
  `inspectDeviceRedirects`, `inspectToolchainWrites`, `quotedRootedPaths`, actionable
  refusals, `replace_lines` classified
- `agent/session.ts` — the repair hook, the file tools, `agentsFilesOverride`, and the
  `before_provider_request` sampling pin; `DEFAULT/MIN/MAX_SAMPLING_TEMPERATURE`
- `agent/auto-commit.ts` — `replace_lines` in `COMMITTING_TOOLS`
- `ipc.ts` / `index.ts` — `samplingTemperature` config and validation, `initializeSkills`
- `Settings.tsx` — a Temperature field; `ToolBubble`/`InlineApproval`/`ApprovalRecord` —
  `replace_lines` labels
- First tests for `permission-gate.ts`, which is the sole security boundary and had none

## Decisions

**Read Pi's guidance, never restate it.** The four `edit` bullets are Pi's and change
with Pi. Copying them into Pi Taster's prompt would have fixed the symptom and created a
second source of truth that drifts silently — the same failure mode as the tool list
that `.claude/rules/` had already removed from the prompt.

**Keep Pi's `edit`.** `baseToolsOverride` would have allowed a hardened replacement, but
it replaces Pi's *entire* tool set, and the `tool_call`/`tool_result` hooks turned out to
be enough. Nothing here forks a Pi tool.

**The repair hook explains; it never lies and never blocks.** `isError` stays true — Pi's
`ToolResultEventResult` would allow flipping it, and doing so would tell the model a
change landed when the file is untouched. The failure streak escalates by naming a
different tool rather than refusing the edit: a model with no way to change the file is
worse than one editing badly.

**No numbered-`read` tool.** `replace_lines` needs line numbers and Pi's `read` has none,
but adding a second read tool would cost a schema on every request for every session,
including the ones that never fail an edit. The repair message supplies the numbers
instead, so the cost falls only where the need is.

**Temperature 0 by default, null to opt out.** Most of a coding turn is reproducing text
that already exists exactly. Ollama's default comes from the Modelfile and is 0.7 or
higher on the models Pi Taster targets.

## Deviations from Plan

- **The plan proposed a numbered-read tool alongside `replace_lines`.** Dropped for the
  reason above once the repair message was carrying line numbers anyway.
- **`confineContextFiles` moved out of `session.ts`** into `agent/context-files.ts`.
  Testing it in place meant importing `session.ts` and all of Pi; the filter is where the
  ancestry bug lives and deserved direct tests.
- **`replaceLinesInFile` was extracted from the tool.** Pi's `execute` takes five
  arguments, two of them runtime objects a test would have to fake, and none of which the
  logic uses.
- **The quoted-path hole was not in the plan.** Found by probing the new redirect check
  for evasions; see below.
- **`packages/shared` gained a `tsconfig.build.json`.** Its `build` and `typecheck` share
  one config, so excluding tests from the emitted `dist` would have excluded them from
  typechecking too.

## Review

`self-modification-auditor` and `electron-security-reviewer` both ran on the diff, as
`CLAUDE.md` requires for changes to the tool surface and to IPC.

- **The auditor found one real widening**: `/usr/local` and `/opt/homebrew` in the shell
  exemption. Fixed as described under Gotchas — the prefixes are now three classes and
  writes into the writable two are refused.
- Its two other findings — `replace_lines` and the repair hook resolving paths with a bare
  `resolve` rather than `resolveLikePi` — had already been fixed mid-session, from the same
  reasoning, before the report landed. Neither could escape the root (`resolveLikePi` is
  the more escaping of the two, so anything the gate allows is in-root either way), but
  both would have written or quoted the wrong file for an `@`-prefixed path.
- It confirmed the things most worth confirming: the repair hook cannot flip `isError`
  (Pi only overwrites the field when a handler sets it explicitly), auto-commit is not
  reordered or swallowed, and `replace_lines` is registered all four ways.
- The security reviewer found nothing exploitable. Its two suggestions were taken: an
  explicit `.catch()` on the fire-and-forget `initializeSkills()`, since main has no
  global unhandled-rejection guard, and named `MIN`/`MAX_SAMPLING_TEMPERATURE` constants
  rather than three unlinked copies of `0` and `2`.

## Gotchas

**`systemPromptOverride` silently discards every tool's prompt guidance.** This is the
session's central finding. Pi's `buildSystemPrompt` takes a `customPrompt` early return
(`dist/core/system-prompt.js:13-34`) that appends the append-prompt, project context
files, the skills block and the cwd — and drops `toolSnippets` and `promptGuidelines`
entirely. Pi Taster has supplied a custom prompt since Pi was adopted, so the model had
*never* been told how `edits[]` works. Nothing surfaces this: the prompt looks complete,
the tool schemas are still sent, and the only symptom is a model that edits badly.

**Pi's edit error misnames its own cause.** `normalizeForFuzzyMatch`
(`dist/core/tools/edit-diff.js:31-50`) already forgives trailing whitespace, CRLF, BOM,
NFKC differences, smart quotes, every Unicode dash, NBSP and exotic spaces. So
`The old text must match exactly including all whitespace and newlines` fires on the one
thing it does not name: **leading indentation** (or internal whitespace runs, or
blank-line counts). Told "all whitespace", the model retries the same indentation.

**There is no `replace_all`, and uniqueness is a hard error** — while Pi's own guideline
says to keep `oldText` minimal. Those pull in opposite directions: a smaller anchor is
less whitespace to get wrong and more likely to collide. Both errors now come back with
line numbers.

**`before_provider_request` replaces the payload by return value.** Unlike `tool_call`,
where arguments are patched by mutating `event.input` in place, this hook's handler return
value *becomes* the payload (`dist/core/extensions/runner.js:834-836`, consumed by
`sdk.js` `onPayload`). It is the only route to sampling Pi exposes — there is no
temperature in `models.json`, `SettingsManager`, or `createAgentSession`.

**The shell scan never looked inside quotes.** `tokenizeCommand` excludes quote characters
from a token *and* requires a token to begin at an unquoted word boundary, so
`cat "/etc/passwd"` had been passing the scan for as long as the scan existed —
independently of this session's exemptions, and it would have defeated the new redirect
check too (`> "/dev/disk0"`). `quotedRootedPaths` closes the absolute and `~`-rooted case.
A quoted *traversal* is deliberately still ignored: a quoted `../` is usually a grep
pattern, and refusing it would be the same class of false refusal as refusing
`2>/dev/null`.

**"Can `bash` already do this by bare command name?" is only half the test.** That
question licenses exempting the read-only system directories from the path scan, and it
is the one this session's first draft asked. It fails for *writes*: `/usr/local` is
outside SIP and `/opt/homebrew` is the Apple Silicon Homebrew prefix, so both are
user-writable and both are on the `PATH` every other program on the machine uses. A bare
command name can run `git`; it can never overwrite the `git` on the user's `PATH` — only
spelling the absolute path can, and that is a persistent backdoor outside the sub-app that
survives into every future shell. Caught by `self-modification-auditor`, which is exactly
the review `CLAUDE.md` requires for a change to this file. The prefixes are now three
classes, and `inspectToolchainWrites` refuses a redirect into the writable two or a
file-writing command aimed at them.

**A write test that reads every token mistakes a subcommand for a command.** The first
version of `inspectToolchainWrites` scanned all tokens for a file-writing command name, to
catch `cmd | tee /opt/homebrew/bin/x`. It also refused `/opt/homebrew/bin/bun install` —
the same class of false refusal as `2>/dev/null`, reintroduced by the fix for it.
`commandPositionNames` splits on shell separators and takes each segment's leading word,
so a pipeline stage counts and a subcommand does not.

**`'> /dev'` in `BLOCKED_COMMANDS` was refusing `/dev/null`.** It was a substring test
aimed at block devices. Half of the reported bug was that entry; the other half was the
token scan, which refused `2>/dev/null` with no space for it to match on.

**A tool that resolves its own paths must resolve them like the gate.** The gate checks
`resolveLikePi`, which strips a leading `@`, expands `~`, and normalizes unicode spaces.
`replace_lines` and the repair hook originally used a bare `resolve`. In this direction the
mismatch was fail-safe — `resolveLikePi` is the more escaping of the two, so anything it
allows is in-root either way — but "allowed `src/App.tsx`, wrote `@src/App.tsx`" is still
the wrong file.

**Pi's context-file discovery walks up from `cwd`.** Sub-apps live under
`~/.pitaster/apps/`, so `~/.pitaster/AGENTS.md` and `~/AGENTS.md` were entering every
session's prompt: unbounded text against a 32k window, invisible in the UI, describing a
different project. Verified by planting a sentinel — and note the *system prompt is not in
Pi's transcript*, so this cannot be checked after the fact from a session file.

**Runtime skills were still never installed**, as Session 19's notes predicted. The
directory was read by the agent and by the Skills panel and written by neither, so a fresh
machine ran with no skills — including `working-notes`, which is the convention the
post-compaction nudge sends the model to read. The content is embedded as constants
rather than copied out of `docs/` because a packaged app does not ship the repository's
`docs/` tree: reading from it would work in development and fail silently in a build.

**The prompt grew by ~330 tokens** (≈430 → ≈757). That is 1% of a 32k window and buys the
guidance that was missing entirely, but it is the reason the guidance must come off Pi's
definitions rather than be extended by hand.
