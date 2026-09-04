# Session 22 Notes: Code Intelligence and a Real Editing Surface

Both sub-sessions landed. 300 tests pass, `typecheck:all` is clean, and every claim below
was verified in the built app through the `run-app` driver.

## What was built

### 22.1 — the compiler

**`agent/ts-service/`** — a `ts.LanguageService` per sub-app in an Electron
`utilityProcess`. `host.ts` builds it rooted at the app root and infers a permissive
config when there is no `tsconfig.json`; `queries.ts` holds the operations and lets
nothing from the `ts` namespace across the port; `worker.ts` and `client.ts` are the
process boundary; `registry.ts` reference counts one service per app so the agent and the
code panel share a program.

**`agent/diagnostics-note.ts`** — the changed file's compiler errors, appended to the
`tool_result` of every successful `write`, `edit` and `replace_lines`. Zero schema tokens.
Capped at the source, because `edit` and `write` are outside `TRUNCATABLE_TOOLS` and
nothing downstream will cut what it appends.

**`code_intel`** (`outline`, `read_symbol`, `definition`, `references`, `hover`) and
**`refactor`** (`rename`, `organize_imports`, `apply_fix`) in `agent/code-tools.ts`.
Classified in `permission-gate.ts`: `code_intel` into `PLAN_READ_TOOLS` and `FILE_TOOLS`,
`refactor` into `FILE_TOOLS` only, both into `PATH_TOOLS`. `autoCommitRefactor` commits
every file a rename rewrote in one commit.

### 22.2 — the editing surface

**`agent/patch.ts`** — unified diffs on the tool result's `details`, which never reaches
the model, plus `previewPatch` for the approval prompt. **`DiffView.tsx`** renders them
with both line-number gutters. **`main/files.ts`** plus `files:tree`, `files:read` and
`files:diagnostics` gave the renderer its first ability to read a file at all.
**`components/code/`** is the new `code` panel: file tree beside a read-only Monaco
viewer, with squiggles from the same service that checks the agent's writes.
`VersionControl` finally consumes `getDiff` — a commit expands to show what it contains.

Deleted `DiffViewer.tsx` and `ToolApprovalDialog.tsx`; both were orphaned and the former
did not diff.

## What the tests caught

**`getCodeFixesAtPosition` over a whole line corrupts files.** Asked for error 2551 across
`export const value = shape.widht`, TypeScript answered *"change spelling of `export` to
`Report`"* — a well-formed fix that rewrote the wrong token. The fix must be requested at
the diagnostic's own span. This would have shipped silently; `apply_fix` would have
mangled a file every time a diagnostic sat on a line with another identifier on it.

**Renaming a shorthand property changes a module's public shape.**
`findRenameLocations` without `providePrefixAndSuffixTextForRename` rewrites
`export const bag = { helper }` to `{ compute }` rather than `{ helper: compute }`,
silently renaming an exported key.

## What was verified in the app

1. Asked the agent for a file containing a type error. The write's tool result carried
   `1 TypeScript error in src/broken.ts: 1:14 Type 'string' is not assignable to type
   'number'.` — confirmed in the session JSONL, not just inferred from the model's reply,
   which it could have produced on its own.
2. An `edit` rendered as a real diff in the transcript: `+1 −0`, hunk header, and the
   context lines' numbers shifting 1→2, 2→3.
3. In `Ask to edit`, the approval prompt showed `+1 −1` and the two changed lines *before*
   Allow/Deny.
4. The code panel listed the sub-app's real tree with `node_modules` hidden, opened
   `src/App.tsx` in Monaco with the Pi Taster theme, and reported `⚠ 1 error` on a file with
   a type error — over IPC, from the shared service.

## What the security review caught

Both review subagents `CLAUDE.md` mandates were run, and both found real bugs in this
session's code. All are fixed, with tests that fail without the fix.

**CRITICAL — `code_intel` and `refactor` were not confined.** `checkConfinement` inspects
the one `path` the model names, and that was the only check. The compiler names other
paths: an in-root file importing `../../other-app/src/config` pulls that file into the
program, so `references` returned its source lines and `rename` returned an edit for it —
and since `relative()` on an out-of-root file yields `../` segments, `applyEdits`'
`join(rootPath, edit.path)` resolved straight back out. The read leak worked in **`plan`
mode** unprompted; the write worked **auto-approved** under `acceptEdits`. Fixed in three
places: the host's filesystem callbacks are gated to the root plus TypeScript's own
`lib.*.d.ts`; `toFileEdits`, `definition` and `references` drop out-of-root results; and
`applyEdits` re-checks each path with `isWithinRoot` immediately before writing.
`tsconfig.json`'s `include` list is filtered too, since the agent can write that file.

The comments asserting the opposite invariant — that the host "refuses it a second time" —
were corrected rather than left to be believed later.

**HIGH — a partial `refactor` failure left files uncommitted.** The write loop returned
early on the first failure, before `autoCommitRefactor`. Those files were then untracked,
and `rollback` is a `git checkout`: it restores tracked files and leaves untracked ones
alone, so they would have survived every subsequent rollback. Now the error path commits
what landed before reporting.

**HIGH — `files:read` trusted a renderer-supplied `appPath`.** `isWithinRoot` only means
"inside whatever string the caller called the root", so `readFile('.ssh/id_rsa', '/Users/x')`
would have passed every check. `resolveAppRoot` now accepts only paths `AppManager`
recognises. The same latent hole existed on the seven `version:*` handlers, dormant
because nothing in the renderer passed an `appPath`; the commit diff is the first real
consumer, so they were fixed with the same helper.

**MEDIUM — `refactor`'s file list was uncapped**, unlike every other list in the module,
while also being exempt from the trimmer. Now capped at 40 with a count.

Confirmed clean: the preload bridge (narrow named functions, no raw `ipcRenderer`), the
`utilityProcess` spawn (`buildSubprocessEnv`, `stdio: 'ignore'`, fixed worker path), the
CSP (unchanged — Vite's `?worker` import gives a same-origin worker, so no `worker-src` or
`unsafe-eval` widening), and the renderer components (no `dangerouslySetInnerHTML`
anywhere; patch text and file contents are plain text nodes).

## Deviations from the plan

- **The plan named four files under `ts-service/`; there are six.** `protocol.ts` was
  split out so no `ts` type crosses the process boundary, and `registry.ts` was added when
  the code panel turned out to need the same service the agent uses — the plan had the
  client owned by `createAgentHost`, which would have meant two programs and two answers
  to whether the code compiles.
- **`@monaco-editor/react` was not used.** It loads Monaco from a CDN by default. A thin
  local wrapper over `monaco-editor` ESM replaced it.
- **Monaco is imported per-tokenizer.** Importing it whole took the renderer bundle from
  1.3 MB to 9 MB. Selecting the thirteen grammars the agent actually writes — the same set
  `CodeBlock.tsx` registers — brings the total to 6.8 MB, of which ~5 MB is Monaco's core.
- **JSON maps to the JavaScript tokenizer.** Monaco has no basic JSON grammar; the JSON
  language *feature* that provides one costs 3.2 MB for schema validation nobody asked
  for. The JavaScript tokenizer colours JSON correctly for nothing.
- **The human-editable editor is still out of scope**, as planned. It raises a real
  concurrency question against auto-commit and the agent's own writes.

## Known gaps

- **`web_fetch`'s `promptGuidelines` never reach the model either.** The same
  `systemPromptOverride` early return that `tool-guidance.ts` exists to work around drops
  them, and `renderToolGuidance` only reads Pi's built-in factories. `code_intel` and
  `refactor` avoid it by putting their guidance in `system-prompt.ts`; `web-tools.ts` still
  carries dead metadata. Not fixed here because it is not this session's bug.
- **`refactor` computes its edits, then takes its locks.** A concurrent write landing in
  that window would make them stale. Accepted; the alternative is holding locks across the
  whole query.
- **Symlinks are still followed.** A symlink planted inside the app root pointing outside
  it is read through, by the code panel and by the agent alike. That is the pre-existing
  limitation of `resolveLikePi`/`isWithinRoot`, documented in `AGENTS.md` as best-effort;
  `files.ts` inherits it rather than adding to it, and now says so.
- **No impact-cascade diagnostics.** Dependent files are named, never quoted.
