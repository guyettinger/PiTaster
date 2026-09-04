# Session 22: Code Intelligence and a Real Editing Surface

**Goal**: Give the agent a compiler instead of a text matcher, and give the human
something to look at other than `JSON.stringify(input)`.

| Sub-session | Focus |
|---|---|
| **22.1** | TypeScript language service, diagnostics on every write, `code_intel`, `refactor` |
| **22.2** | Files IPC, patches in tool bubbles and approvals, a `code` panel with Monaco |

## The problem

**The agent cannot check its own work.** `AGENTS.md` calls `typecheck:all` "the gate that
the self-modification flow relies on" — but that gate is Pi Taster's, run by a human. A
confined agent working in a sub-app has none. `bash` is deliberately absent from
`PLAN_READ_TOOLS` and from `FILE_TOOLS` (`permission-gate.ts`), so in `acceptEdits` — the
mode this app is built to be run in — the model writes TypeScript and *cannot run `tsc`*
without stopping to ask. Every edit is unverified until a human runs the app.

**Cross-file refactoring is grep plus N edits.** `AGENTS.md` devotes a section to why
text-matched editing fails on a local model: Pi's matcher "forgives nothing about leading
indentation, internal whitespace runs, or blank-line counts." A rename across eight files
is eight independent chances to hit exactly that, and `edit-repair.ts` catches it only
after the failure, one file at a time.

**Symbol navigation is `grep`.** Finding a definition costs a grep plus one or more
whole-file reads, against a window `context-budget.ts` is already fighting to protect.
And `grep` is *wrong* for identifiers: it matches the name in comments, in strings, and
in unrelated symbols that happen to share it.

**The human cannot see what changed.** `ToolBubble.tsx` renders an `edit` as its `path`;
expanding shows `JSON.stringify(input, null, 2)` and 500-char-truncated output. The safety
story of this app is "every write is auto-committed so you can roll it back," and you
cannot see what you would be rolling back. `DiffViewer.tsx` exists, is imported by
nothing, and does not compute a diff. `getDiff` is plumbed through `preload/index.ts` and
typed in `electron.d.ts` with no consumer.

**Approvals are blind.** In `default` mode you approve a `write` knowing only its path.

## Why Pi Taster's own, and not a package

The published Pi LSP extensions solve this — `pi-lens` (38K/mo), `pi-lsp-extension`,
`pi-hashline-edit-pro` — and none of them can be installed here.

A Pi extension is a TypeScript module that runs unsandboxed in the Electron main process
and may register its own `tool_call` handler, which means it can mutate the arguments
`permission-gate.ts` just approved. `AGENTS.md` states that gate is "the *only* boundary
between the model and the filesystem"; installing npm extensions makes that false. They
are also TUI-shaped — `ctx.ui.*`, `renderCall` returning `pi-tui` components, none of
which Pi Taster's React renderer can draw — and sized for cloud context windows.

What they taught us is in the design below. `pi-lsp-extension`'s noise discipline in
particular: diagnostics scoped to the changed file, errors only, hard-capped.

## Design decisions

**One in-process TypeScript LanguageService, in a `utilityProcess`.** All five sub-app
templates are TypeScript/JavaScript, so the whole universe the confined agent can reach
is one language and a generic LSP client buys nothing today. The `LanguageServiceHost` is
where confinement comes from: the model never hands the compiler a path, it names a file
relative to the root and `TsProject.resolve` refuses anything that escapes. It runs out
of process because the service is synchronous and its first call builds a whole program —
seconds, on the thread that also pumps the agent's event stream.

**Schema tokens are the budget: two tools, not ten.** `resolveToolNames` already *removes*
four tools below 32k. Ten LSP tools would invert that. Read and write cannot share one
tool, because `checkPermission` classifies by name — a combined tool would have to be a
write, and `plan` would lose navigation.

**Symbols are addressed by name, never by `line:character`.** A model asked for an exact
offset gets it wrong for the same reason it gets an `edit`'s indentation wrong, and
unlike a failed `edit` a wrong offset does not error — it answers confidently about the
wrong token. Ambiguity returns candidates with their lines rather than a guess. The one
exception is `apply_fix`'s `line`, which is the number Pi Taster printed in the diagnostics
attached to the model's last write: the same pairing that makes `replace_lines` usable.

**The zero-cost channel is `details`.** It never reaches the model, so the unified patch
and the diagnostic objects travel there and cost nothing in context. That is what makes
22.2's diff UI free.

**Monaco for panels, `lowlight` for the transcript.** Monaco is Theia's editor and
Theia's diff view; taking it directly gets the surface without Theia's framework, which
owns an application and cannot be a component in React 19 + Vite. One instance per panel,
never per transcript row — thirty tool calls must not mean thirty editors. And no CDN:
`@monaco-editor/react` loads Monaco remotely by default, which is disqualifying for an
app whose identity is that inference never leaves the machine.

**Deliberately excluded.** `ast-grep` (needs a native binary; `findRenameLocations` plus
`organizeImports` plus `getCodeFixes` cover what a sub-app needs). A human-editable
editor (raises a real concurrency question against auto-commit that deserves its own
design). Full impact-cascade diagnostics (a token risk on 32k — we name the broken files
and quote none of their errors).

## 22.1 — Code intelligence

1. **`agent/ts-service/`** — `host.ts` (the `LanguageServiceHost`, rooted and confined),
   `queries.ts` (the operations, returning plain JSON), `worker.ts` (the `utilityProcess`
   entry), `client.ts` (spawn, correlate, time out, restart, evict), `protocol.ts` (the
   wire shapes; nothing from the `ts` namespace crosses).
2. **`agent/diagnostics-note.ts`** — errors appended to a successful `write`, `edit` or
   `replace_lines`, on the existing `tool_result` hook beside `edit-repair` and
   `auto-commit`. The budget is enforced *here*: `edit` and `write` are outside
   `TRUNCATABLE_TOOLS`, so nothing downstream will cut what this appends.
3. **`code_intel`** — `outline`, `read_symbol`, `definition`, `references`, `hover`.
   Read-only, so it goes in `PLAN_READ_TOOLS` as well as `FILE_TOOLS`, and in
   `TRUNCATABLE_TOOLS` because its results are evidence like `read`'s.
4. **`refactor`** — `rename`, `organize_imports`, `apply_fix`. Writes, so `FILE_TOOLS`
   only. `autoCommitRefactor` commits every rewritten file together; committing only the
   file the symbol was named in would leave a rollback that restores the declaration and
   keeps every updated call site.
5. **Guidance in `system-prompt.ts`, not on the tool definitions.** `systemPromptOverride`
   drops every tool's `promptGuidelines` — the gap `tool-guidance.ts` exists to close for
   Pi's built-ins — so guidance on Pi Taster's own tools would be dead metadata.

## 22.2 — The editing surface

6. **Patches in `details`** for every write, from the commit `auto-commit.ts` just made.
7. **Diffs in `ToolBubble` and `InlineApproval`**, rendered with the already-installed
   `lowlight` and its registered `diff` grammar.
8. **`main/files.ts`** — `files:read` and `files:tree`, confined by `isWithinRoot` and
   `resolveLikePi` imported from `permission-gate.ts`, so the human's view and the agent's
   confinement cannot drift.
9. **A `code` panel** — file tree, read-only Monaco driven by the *same* language service
   over IPC, and Monaco's `DiffEditor` for a commit in `VersionControl.tsx`. Delete the
   orphaned `DiffViewer.tsx` and `ToolApprovalDialog.tsx`.

## Verification

`bun test` for the units; `bun run typecheck:all` for the gate; the `run-app` skill for
the loop end to end — introduce a type error and confirm the diagnostic arrives in the
edit's own result; rename across three files and confirm one call, one commit, one patch.
Review with `self-modification-auditor` and `electron-security-reviewer`.
