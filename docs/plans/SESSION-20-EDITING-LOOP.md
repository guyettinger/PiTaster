# Session 20: The Editing Loop

**Goal**: Make the agent able to edit a TypeScript file repeatedly across a long
session without whitespace roulette — by giving back the editing guidance anyapp
was silently throwing away, turning a failed edit into a grounded next attempt,
and letting a shell command redirect to `/dev/null`.

## Why

Session 19 made a long session survivable: the real context window, scaled
compaction, visible recovery, shaped context. What it did not touch is the loop a
long TypeScript task actually spends its turns in — read, edit, typecheck, edit
again. Two symptoms reported from real use, both defects rather than model
weakness.

### 1. anyapp discards Pi's editing guidance

Pi assembles its system prompt from per-tool contributions: each tool definition
carries a `promptSnippet` and a `promptGuidelines` array, and `buildSystemPrompt`
renders them as an `Available tools:` list and a `Guidelines:` list. The `edit`
tool contributes four bullets (`dist/core/tools/edit.js:25-33`):

```
Use edit for precise changes (edits[].oldText must match exactly)
When changing multiple separate locations in one file, use one edit call with
  multiple entries in edits[] instead of multiple edit calls
Each edits[].oldText is matched against the original file, not after earlier
  edits are applied. Do not emit overlapping or nested edits.
Keep edits[].oldText as small as possible while still being unique in the file.
```

anyapp supplies `systemPromptOverride`, so `buildSystemPrompt` takes its
`customPrompt` early return (`dist/core/system-prompt.js:13-34`). That branch
appends the append-prompt, project context files, the skills block and the cwd —
and **drops `toolSnippets` and `promptGuidelines` entirely**. Every one of those
bullets is discarded, for every tool. anyapp's own prompt says only "prefer
`edit` over `write`" (`system-prompt.ts:148`). The model is never told that
`edits[]` is an array of disjoint replacements resolved against the *original*
file, and never told the uniqueness rule.

The result is the reported error, over and over:

```
Could not find the exact text in src/App.tsx. The old text must match exactly
including all whitespace and newlines.
```

### 2. That error is wrong about its own cause

Pi's matcher is not exact. `fuzzyFindText` tries `indexOf`, then retries in a
normalized space (`dist/core/tools/edit-diff.js:31-50`) that already tolerates:

- trailing whitespace, per line
- CRLF and CR line endings, and a leading BOM
- NFKC differences, smart quotes, every Unicode dash, NBSP and exotic spaces

What it does **not** tolerate is leading indentation, internal whitespace runs,
and blank-line counts. So the one thing the message insists on — "all whitespace"
— is mostly already handled, and the thing that actually failed is never named. A
small model reads "match exactly", retries with the same indentation, and fails
identically.

Two structural aggravators:

- **There is no `replace_all`, and uniqueness is a hard error.** A model wanting N
  identical replacements must write N uniquely-anchored edits. Pi's own guideline
  pushes anchors to be *minimal*, which is exactly what makes them collide:
  `Found 3 occurrences of the text in … The text must be unique.`
- **Nothing in anyapp reacts to a failed edit.** `agent/loop-guard.ts` blocks a
  third *byte-identical* call. A model retrying with a slightly different
  `oldText` each time never trips it and loops until the user stops it.

### 3. `/dev/null` is refused

`inspectCommand` (`permission-gate.ts:298-325`) scans a shell command's tokens and
refuses any absolute path outside the app root. So:

```
bash bun run build 2>/dev/null
  → Error: Path outside the app directory: /dev/null
```

`> /dev/null` with a space additionally trips the literal `'> /dev'` entry in
`BLOCKED_COMMANDS`, which exists to stop writes to block devices and catches the
null device with it. Every absolute toolchain path — `/usr/bin/env`,
`/opt/homebrew/bin/bun` — and the OS temp directory are refused the same way. The
refusal is also inert as guidance: it names the token and says nothing about what
to do instead, which is all the model gets.

### 4. Three gaps found while auditing the rest

**Runtime skills are never installed.** `loadPiSkills` reads `~/.anyapp/skills`
(`session.ts:498`); nothing in the app ever writes it. `docs/skills/*/SKILL.md`
are copies with no install step, and `ipc.ts:93` only *reads* the same directory
for the UI. On a fresh machine the agent has zero skills — which means
`working-notes`, the `NOTES.md` convention that `COMPACTION_NOTICE`
(`session.ts:306`) explicitly points the model at after every compaction, is never
taught. Session 19's own gotcha list flagged this; it is still true.

**`AGENTS.md` ancestry leaks into every sub-app prompt.** Pi's
`loadProjectContextFiles` (`dist/core/resource-loader.js:32-51`) walks *up* from
`cwd` and also reads `agentDir`, wrapping what it finds in `<project_context>`.
anyapp passes neither `noContextFiles` nor `agentsFilesOverride`, so a stray
`~/AGENTS.md` or `~/.anyapp/AGENTS.md` silently enters every session — unbounded
text against a 32–65k window, and invisible in the UI.

**Sampling is unpinned.** Pi exposes no temperature and `models.json` carries
none, so every request inherits the model's Modelfile default — 0.7 to 1.0 on the
qwen builds anyapp targets. Reproducing a code region's exact whitespace is
precisely the task that default ruins.

## What Ships

Pi's `edit` tool is kept as-is. Everything here is host-side: two extension
hooks, one new tool, prompt text, and a seeding step. `baseToolsOverride` is
deliberately not used — it replaces Pi's whole tool set, and the hooks suffice.

### `agent/tool-guidance.ts` — give the guidance back

Read it off Pi's live tool definitions rather than restating it, so it cannot
drift when Pi changes. `createEditToolDefinition` and its siblings are exported
from the package root, and every `ToolDefinition` carries `promptSnippet` and
`promptGuidelines` as public fields.

`getToolGuidelines(toolNames)` returns the deduped guidelines for the tools a
session actually enabled, mirroring what Pi's non-custom branch does.

### `agent/system-prompt.ts`

The guidance block, plus an `## Editing Files` section carrying what Pi's own
guidance does not:

- Re-read the region immediately before editing it. An edit built on a read from
  several turns ago is built on text the trimmer may have truncated or replaced.
- `oldText` must reproduce **leading indentation** exactly. Trailing whitespace,
  line endings and smart quotes are tolerated; indentation is not.
- After a failed edit, do not retry a guessed variant. Use the exact text the
  failure quotes back, or `replace_lines` with the numbers it gives.

### `agent/edit-repair.ts` — a `tool_result` hook

On a failed `edit`, classify Pi's message and replace the result with something
actionable. `ToolResultEventResult.content` is a real chained override
(`dist/core/extensions/runner.js:693-744`); `isError` stays true — the edit did
fail.

- **Not found**: read the file, locate the best near-match with an
  indentation-insensitive line comparison, and quote that region back with
  1-indexed line numbers, naming how it differed.
- **Duplicate**: report the line of each occurrence.
- **No change / overlap / empty**: restate in one actionable line.
- **Escalation**: after three consecutive failures on one path, tell the model to
  stop guessing — re-read and use `replace_lines`, or rewrite with `write`. This
  is the case the loop guard structurally cannot catch.

Token-bounded by construction: the quoted region is capped from
`ContextBudget.maxToolResultTokens`.

### `agent/file-tools.ts` — `replace_lines`

`path`, `startLine`, `endLine` (1-indexed inclusive), `newText`. Editing by line
number never depends on reproducing whitespace, and the repair message is what
supplies the numbers — so no numbered-read tool is added; the numbers arrive with
the failure that needs them. Preserves the file's line ending and trailing-newline
state, and reports the new line count so the model knows numbers have shifted.

Registered the four ways `.claude/rules/self-modification.md` requires: the
allowlist, `FILE_TOOLS` and `PATH_TOOLS`, `checkConfinement` (automatic via
`path`), and `COMMITTING_TOOLS`. Kept in both tool profiles — editing is not what
a lean profile should give up.

### `agent/permission-gate.ts` — safe paths

`SHELL_SAFE_DEVICES` matched exactly, and `SHELL_SAFE_PREFIXES` for read-only
toolchain locations plus the OS temp directory. The `'> /dev'` blocklist entry
becomes a check that still refuses `> /dev/disk0`. Both refusal messages say what
to do instead.

The widening is documented for what it is: naming `/usr/bin/sed` is not new
capability — `bash` could always run `sed` — and `/tmp` writability is not an
escalation over a model that can already write and run a script inside the app
root. It is still a widening of a best-effort scan, and is described as one.

### `agent/session.ts`

The repair hook; the resolved tool names into `getSystemPrompt`;
`agentsFilesOverride` filtered through the existing `isWithinRoot` so a sub-app's
own `AGENTS.md` still works and the ancestry stops leaking; and a
`before_provider_request` handler returning `{ ...payload, temperature }` — the
handler's return value replaces the payload (`runner.js:834-836` →
`sdk.js:208-214`), which is the only route to sampling Pi exposes. Default 0,
configurable, skipped entirely when null.

### `packages/shared/src/skills/seed.ts`

The seed skills as constants, following `DEFAULT_GITIGNORE` in
`apps/templates.ts` — which also sidesteps packaging `docs/` into the built app.
`seedSkills` writes only what is absent, never overwriting a skill the user edited.

## Verification

- `bun run typecheck:all`, `bun test`. New suites include the first tests for
  `permission-gate.ts`, which is the sole security boundary and had none.
- `self-modification-auditor` on the gate and the new tool;
  `electron-security-reviewer` on the IPC and Settings diff.
- Driven in the real app: an indented edit that fails once and then succeeds, and
  `bun run build 2>/dev/null` executing. The system prompt is measured, not
  assumed — this session adds to a prompt on a window that cannot afford much.
