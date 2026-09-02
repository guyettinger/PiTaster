# anyapp

Self-modifying Electron desktop app. The agent reads and writes its own source
code — and the source of sandboxed sub-apps it creates — with every write
auto-committed to git so any change can be rolled back.

The agent is [Pi](https://pi.dev/) (`@earendil-works/pi-coding-agent`), embedded
through its SDK in `apps/electron/src/main/agent/`. It runs entirely on local
models served by **Ollama** — there is no API key and no inference network call.
The agent can reach the internet with its `web_fetch` tool, but inference itself
never leaves the machine.

Pi owns the agent loop, the built-in tools (`read`, `write`, `edit`, `bash`,
`grep`, `find`, `ls`), and the session transcript. anyapp adds the permission
gate, path confinement, git auto-commit, its own version-control, network and
skill tools, and a bridge that exposes connected MCP sources' tools as
`mcp__<source>__<tool>`.

## Monorepo layout

Bun workspaces. Inter-package dependencies use `"workspace:*"`.

| Path | Package | Contents |
|------|---------|----------|
| `apps/electron/` | `@anyapp/electron` | The desktop app |
| `packages/core/` | `@anyapp/core` | Shared TypeScript types only |
| `packages/shared/` | `@anyapp/shared` | Business logic: apps, chat, skills, sources, versions, inspector |

`apps/electron/` follows the electron-vite convention:

- `src/main/` — main process (Node.js): agent, IPC, screenshots, window setup
- `src/preload/` — context bridge (isolated); the only channel between main and renderer
- `src/renderer/` — React 19 UI (browser context, Vite + Tailwind v4)

Import types from `@anyapp/core`, business logic from `@anyapp/shared`. Neither
package may import from `apps/electron/`.

## Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Start the app with hot reload |
| `bun run build` | Build all packages |
| `bun run typecheck:all` | Type check the entire monorepo |
| `bun run sync:skills` | Regenerate the seeded skills from `docs/skills/` |
| `bun run --filter @anyapp/electron dev` | Run one workspace |

Run `bun run typecheck:all` after changing any source file. It is the gate that
the self-modification flow relies on.

## Runtime prerequisite

The agent needs a running Ollama daemon and a **tool-calling** model. A model
without tool support will connect and then be unable to act.

```bash
ollama serve
ollama pull qwen3-coder:30b   # or llama3.1, gpt-oss, mistral-nemo
```

Models are discovered from the daemon and written to `~/.anyapp/pi/models.json`;
pick one in Settings. Electron 39+ is required — Pi needs Node >= 22.19.

## The context window is not what Ollama advertises

`/api/show` reports a model's *architectural maximum*; the daemon serves whatever
it auto-sized to, which `/api/ps` reports and only while the model is resident.
On `qwen3.8:27b-mlx` that is 262144 against a served 65536. Believing the
advertised number means Pi never compacts and Ollama silently truncates the head
of the prompt instead — no error, no event, and a model that has lost its system
prompt mid-run.

`num_ctx` cannot be set over the OpenAI-compatible `/v1` endpoint, so the real
window is discovered, not configured: a session warms the model, reads `/api/ps`,
and writes that into `models.json`. `agent/context-budget.ts` derives everything
else from it — Pi's compaction thresholds, `maxTokens`, and the trimmer's
tool-result cap — keeping `reserveTokens + keepRecentTokens < window * 0.9` so
compaction always frees more than it reserves. Pi's own defaults reserve 36k,
which is more than the whole window on the models anyapp targets.

Settings carries an override for when both the daemon and the default are wrong.

## Working within a small window

Four things keep a long session coherent on a local model, all configurable:

- **Compaction** is Pi's, with anyapp's thresholds. `compaction_end` nudges the
  agent to re-read `NOTES.md`, which is on disk and survives being summarized.
- **`agent/context-trim.ts`** runs on Pi's `context` hook and shapes what is
  *sent*: long tool results truncated with a pointer to resume from, a read whose
  every line a later read returned collapsed into that later one, screenshots on
  user messages older than two turns dropped. The transcript, git history and chat
  UI keep everything.

  Superseding compares **regions, not paths**. Pi's `read` caps its output at 2000
  lines or 50 KB and tells the model to "continue with offset until complete", so
  two reads of one file are usually two different parts of it. Keying on the path
  alone collapsed the earlier chunk into a pointer and left the model believing it
  had read a file it had only seen the tail of — silently, with no way to detect
  the loss.

  There are **two size caps**, and they answer different questions.
  `maxToolResultTokens` asks whether a result still earns its space, and the
  current turn is exempt from it — an agent that cannot see what it just did
  repeats it. `hardToolResultTokens`, half the window, asks whether the request can
  succeed at all, and nothing is exempt: past it the result cannot coexist with the
  system prompt, the tool schemas and the surrounding history, so the request fails
  either way — as an unexplained timeout rather than as an oversized result. The
  ordinary cap never falls below Pi's own 50 KB read ceiling where the window can
  afford it, because a cap under that fights the read tool: the read arrives legal
  and is then cut, and Pi's output carries no line numbers for the agent to work
  out what it lost. Truncation preserves that footer by recomputing it for the
  shorter body, and cuts on a line boundary.

  Both caps apply to a named set of tools, so a new tool is exempt until it is
  added — `git_status` and `install_deps` are in the set; the other version tools
  and every MCP tool are not.

  **Compaction does not see any of this.** Pi decides to compact from
  `estimateContextTokens` over `agent.state.messages`, but the trimmer runs as
  `transformContext`, which builds the request and never writes back. So compaction
  fires on the *untrimmed* size, always at or above what is actually sent, and the
  trimmer's savings can never relieve compaction pressure — on a session full of
  large tool results the agent summarizes away history that would still have fit.
  It is also why the trimmer must be idempotent: `transformContext` re-runs on every
  provider request against the same stored messages.
- **Tool profiles** (`resolveToolNames`) drop the branch tools on a small window.
  Every tool's schema is a per-request cost, and a long list makes a small model
  choose worse.
- **`agent/loop-guard.ts`** soft-blocks a third consecutive identical tool call,
  telling the model to change approach rather than burn the window repeating.

## The budget, shown to the person paying it

Everything above decides how the window is spent. The meter in the composer is where a
person finds out — and until Session 23 it was hidden more often than it was shown.

**It was not one bug, it was five.** `agent:get-context-usage` answered off `agentHost`,
which is created lazily on the first prompt, so a session had no number until a turn
finished with the chat panel open. `disposeAgentHost` then runs on an app switch, a
session switch, and *every* skills, sources or config save — so the meter blinked out
several times a minute during ordinary use. The renderer cleared it again on a session
change, rendered it behind a truthiness guard, and Pi reports `tokens: null` right after
a compaction, which is the moment the number matters most.

**The fix is that the fixed half of a request needs no session to measure.** The system
prompt, the tool schemas, Pi's restored tool guidance, the skill manifest and the app's
`AGENTS.md` are pure functions of the app and its configuration. `agent/context-report.ts`
builds them cold — no `ModelRuntime`, no model warm, no TypeScript service — which is why
the meter can now show `6.3k / 32.8k` before a single prompt has been sent, and why the
handler deliberately does **not** call `ensureAgentHost`: that warms the model, and this
runs on every return to the chat panel.

Four states, all of which render: `live` (Pi's provider-anchored total), `estimated` (the
gap after a compaction), `stale` (the host is gone, the conversation is remembered), and
`floor` (fixed cost alone). `stale` is what makes `disposeAgentHost` survivable — ipc.ts
caches the last report and `forgetCachedReport` drops it only where the *conversation*
changes, never on a skills or sources save, because the conversation those disposed is
still the one on screen. The fixed blocks are always taken fresh, so toggling a skill off
shows a smaller manifest immediately while the conversation is carried over unchanged.

**The blocks are estimates and the total is not, and the card says so.** Pi anchors
`ContextUsage.tokens` to the provider's own accounting; every block is chars/4. They will
not agree, and the footer prints both rather than scaling the blocks to close the gap — a
breakdown that always sums to the measured total is one that has been made to.

Three things the module has to keep doing:

- **Measure the prompt's parts, not the whole.** `getSystemPrompt` inlines the skill
  manifest, the MCP section and the tool guidance. Measuring the whole prompt *and* those
  parts charges the user twice for every skill they enable, and turning one off would
  appear to shrink two blocks. The base block is the prompt minus the three.
- **Price an image by difference, never by restating Pi's constant.** Pi bills an image at
  a flat character count anyapp has no business knowing. Subtracting the image-stripped
  estimate from the whole one recovers exactly that charge, and keeps recovering it if Pi
  changes the number.
- **Build tool definitions, never run them.** Sizing a schema means calling every factory —
  `createCodeTools` included — with stubbed callbacks. Nothing calls `execute`, and
  nothing acquires a TypeScript service: seconds of program build to measure a JSON
  schema would be the wrong trade, and it is why the report is not simply read off a
  live session.

The bar's tick is `window - reserveTokens`, which is where compaction fires and the one
number the old meter never showed. `Summarize now` calls Pi's `session.compact()` — the
first thing in anyapp to do so — and is refused mid-turn, because compacting a
conversation Pi is still appending to summarizes a moving target.

Segment colors are assigned by **rank within a group**, not by block id. Keyed by id, the
second-largest block could draw in the palest tone the ramp has, which reads as a bug in
the measurement rather than as an identity.

## Editing is where a long task actually fails

Pi's `edit` matches text. Its matcher already forgives trailing whitespace, CRLF, BOM,
NFKC differences, smart quotes, Unicode dashes and exotic spaces — and forgives nothing
about **leading indentation**, internal whitespace runs, or blank-line counts. Its error
says `The old text must match exactly including all whitespace and newlines`, which
names the part that was already forgiven and not the part that failed. A small model
reads it and retries the same indentation.

Three things address that, and the first was a bug, not a gap.

**Pi's own editing guidance was being thrown away.** Pi assembles its prompt from
per-tool contributions — a `promptSnippet` and a `promptGuidelines` array on each tool
definition — and `edit`'s four bullets are where a model learns that `edits[]` holds
*disjoint* replacements resolved against the original file, and that each `oldText` must
be unique. Supplying `systemPromptOverride` puts `buildSystemPrompt` on its
`customPrompt` early return, which appends context files, skills and the cwd and **drops
`toolSnippets` and `promptGuidelines` for every tool**. So none of it had ever reached
the model. `agent/tool-guidance.ts` reads the text back off Pi's live definitions —
never a copy, so a Pi revision cannot leave anyapp restating something Pi no longer
says — and `system-prompt.ts` renders it. Recovering it costs about 330 tokens, which is
the whole reason it must come off the definitions rather than grow by hand.

**`agent/edit-repair.ts`** runs on `tool_result` and replaces a failed `edit`'s message
with the file's real text: it finds the region the model was aiming at using an
indentation- and blank-line-insensitive comparison, and quotes it back with 1-indexed
line numbers. The next attempt is then a copy rather than a guess. It keeps
`isError: true` — reporting otherwise would have the model believe a change landed. It
also counts consecutive failures per path and, at the third, tells the model to stop
adjusting the text. `agent/loop-guard.ts` cannot cover that case: it blocks a third
*byte-identical* call, and a model re-guessing whitespace produces a different call
every time.

**`replace_lines`** (`agent/file-tools.ts`) edits by line number, so it cannot fail this
way at all. It exists as the second attempt, not the first — the line numbers it consumes
are the ones the repair message just printed. That pairing is why there is no
numbered-`read` tool: the numbers arrive attached to the failure that needs them, and a
session that never fails an edit never pays for them.

Both modules go through `agent/file-lines.ts`, and must keep doing so. If the numbers the
repair hook prints stop meaning what `replace_lines` accepts, the recovery path edits the
wrong lines silently.

Sampling is pinned too, because none of the above helps a model that knows the right
indentation and does not emit it. Pi exposes no temperature — not in `models.json`, not
in `SettingsManager`, not on `createAgentSession` — so `session.ts` sets it through the
`before_provider_request` hook, whose handler's *return value replaces* the request
payload. Ollama otherwise takes its default from the model's Modelfile, which is 0.7 or
higher on the models anyapp targets.

## The compiler is a tool, and mostly not one

The agent could not check its own work. `typecheck:all` is the gate the self-modification
flow relies on, but that gate is anyapp's, run by a human — a confined agent inside a
sub-app has none. `bash` is deliberately absent from `PLAN_READ_TOOLS` and `FILE_TOOLS`,
so in `acceptEdits`, the mode this app is built to be run in, the model writes TypeScript
and cannot run `tsc` without stopping to ask. Every edit was unverified until someone ran
the app.

**One in-process `ts.LanguageService` per sub-app**, in `agent/ts-service/`. All five
templates are TypeScript or JavaScript, so the whole universe the confined agent can
reach is one language and a generic LSP client would buy nothing while costing a
subprocess per language and a per-language install problem.

**Confining it took three layers, and the obvious one was not enough.** `checkConfinement`
refuses an out-of-root `path` before `execute` runs — but that is only the path *the
model* names. The compiler names others: module resolution follows an import wherever it
leads, so an in-root file importing `../../other-app/src/config` pulls that file into the
program, and `references` would then quote its source back and `rename` would offer to
rewrite it. `relative()` on such a file returns `../` segments, and rejoining those
against the root is an ordinary path traversal that happens to have been computed by tsc.
So: the host's `readFile`/`fileExists`/`readDirectory` are gated to the root plus
TypeScript's own `lib.*.d.ts` (`host.ts`), the queries drop any result naming a file
outside the root (`queries.ts`), and `applyEdits` re-checks every path immediately before
writing it (`code-tools.ts`). The last is the one that has to be right, because
`refactor` is auto-approved in `acceptEdits`.

A `tsconfig.json` is a file the agent can write, so its `include` list is filtered too.

It runs in an Electron **`utilityProcess`**, not in main. The service is synchronous and
its first call builds a whole program — seconds, on a sub-app with React's declarations
installed, on the thread that also pumps the agent's event stream. `ts-service/registry.ts`
keys one service per app root and reference counts it, because the code panel is a second
consumer and the editor's squiggles and the agent's errors must come from the same
program or the user and the model end up with two accounts of whether the code compiles.

**The highest-value part is not a tool.** `agent/diagnostics-note.ts` appends the changed
file's compiler errors to the `tool_result` of every successful `write`, `edit` and
`replace_lines`. It costs **zero schema tokens**, which is the whole reason it is a hook
— every published Pi LSP extension converges on this same trick. Its budget is enforced
*at the source*, because `edit` and `write` are absent from `TRUNCATABLE_TOOLS` and
nothing downstream will cut what it appends: errors only, first N with a `+K more` line.
It also names dependent files that have broken *since it last looked*, and claims nothing
about a file it has never checked — a line that cries wolf is a line the model learns to
skip.

**Two tools, not ten.** `resolveToolNames` already removes four version tools below 32k
because a long list measurably worsens which tool a small model picks; ten LSP tools —
the shape every published extension takes — would invert that. So `code_intel` multiplexes
`outline`, `read_symbol`, `definition`, `references` and `hover`, and `refactor`
multiplexes `rename`, `organize_imports` and `apply_fix`. They cannot be one tool:
`checkPermission` classifies by tool *name*, so a combined tool would have to be a write
and `plan` would lose navigation, which is the mode navigation is most of the point in.
Neither is in `LEAN_PROFILE_OMITS` — they earn their schema most on the smallest window,
where a wasted `grep` and the two whole-file reads after it cost a large fraction of the
budget.

**Symbols are named, never addressed by `line:character`.** A local model asked for an
exact offset gets it wrong for the same reason it gets an `edit`'s leading indentation
wrong, and unlike a failed `edit` a wrong offset does not fail — it resolves whatever
token sits there and answers confidently about the wrong thing. Ambiguity returns the
candidates with their lines. The one exception is `apply_fix`'s `line`, which is a number
anyapp printed in the diagnostics attached to the model's last write: the same pairing
that makes `replace_lines` usable.

**`getCodeFixesAtPosition` must be asked at the diagnostic's own span, not the line's.**
Given a whole line and an error code it searches the range for anything matching, and on
`export const value = shape.widht` it answers error 2551 with "change spelling of
`export` to `Report`" — a well-formed fix that silently corrupts the file. There is a test.

**`refactor` needs its own commit path.** `autoCommitToolResult` commits exactly one path,
keyed on `input.path`, which for a rename names only the file the symbol was pointed at.
`autoCommitRefactor` commits every rewritten file together; without it a rollback would
restore the declaration and keep every updated call site. A *partial* failure commits too,
for a sharper version of the same reason: `rollback` is a `git checkout`, which restores
tracked files and leaves untracked ones in place, so a file written but never committed
survives every rollback that follows it.

Guidance for both tools lives in `system-prompt.ts`, not on the tool definitions. Their
`promptGuidelines` would be dead metadata for the reason `tool-guidance.ts` exists — the
`systemPromptOverride` early return drops every tool's contributions.

## Seeing what the agent did

The safety story is that every write auto-commits so any change can be rolled back, and
until Session 22 you could roll a change back without ever having seen it: `ToolBubble`
rendered an `edit` as its path plus `JSON.stringify(input)`, `DiffViewer.tsx` was
imported by nothing and computed no diff, and `getDiff` was plumbed to preload with no
consumer.

**Diffs are free because they travel on `details`.** Pi keeps a tool result's `details`
out of what it sends the model, so `agent/patch.ts` can put a full unified diff there at
no cost in the context window — the caps in that module are about what a person can read
in a bubble, not about tokens. The before-text is captured in the `tool_call` hook rather
than reconstructed from git, so a diff appears whether or not auto-commit is on.

**The approval prompt shows the change before you approve it**, which is where this
matters most: `default` mode used to ask you to take responsibility for a write knowing
only its path. `previewPatch` is **accurate or absent**. `write` and `replace_lines` are
exact. `edit` is Pi's, and its matcher falls back to a fuzzy comparison — reimplementing
that to draw a picture would mean two matchers that must agree forever, so the preview
applies each `oldText` as a plain exact, unique match, a strict subset of what Pi accepts,
and returns nothing at all if any of them does not land.

**Monaco, not Theia.** Theia is a framework that owns an application — Inversify, Lumino,
its own webpack frontend/backend split — and running it embedded in a larger app has been
an open request on its tracker for years. Its editor and its diff view *are* Monaco, so
anyapp takes those directly. Two constraints: **no CDN**, because `@monaco-editor/react`
loads Monaco remotely by default and an editor that needs the network is the wrong shape
for an app whose identity is that inference never leaves the machine; and **only the
tokenizers this app needs**, because importing `monaco-editor` whole registers all
eighty-four language definitions and takes the renderer bundle from 1.3 MB to 9 MB — the
same trap `CodeBlock.tsx` already documents for lowlight's `common` set.

**No Monaco in the transcript.** A chat with thirty tool calls must not instantiate thirty
editors, so tool-bubble diffs are `DiffView.tsx`, which parses the unified diff itself and
renders old and new line-number gutters. The line numbers are the part that matters:
they are what `replace_lines` and `apply_fix` take.

No TypeScript language service is registered in Monaco. It cannot see the sub-app's
`tsconfig.json` or `node_modules`, so it would paint every import as unresolved. The
squiggles come over IPC from the same service that checks the agent's writes.

## What the user sees while waiting

Pi emits compaction, retry and settle events; `agent/events.ts` maps them to
`StreamChunk` `status` so the UI can say what is happening. Prefill has no event
— nothing happens during it — so silence longer than 20s is timed from outside
and reported with an elapsed count. Tool approval prompts have no timeout: a turn
takes minutes, and a timeout does not fail safe, it silently denies.

How long a turn may stay silent is not Pi's setting to enforce. Pi applies
`httpIdleTimeoutMs` only from its own CLI, RPC and interactive entry points,
never from the SDK path anyapp embeds — and does not export the function that
does it. Left alone, the real ceiling is undici's default `headersTimeout` of
300s, and Ollama sends no headers until the first token, so a prefill past five
minutes dies as `Request timed out.` and is retried — one attempt plus four
retries. `agent/http-dispatcher.ts` installs the dispatcher itself at main
startup, which is what makes `HTTP_IDLE_TIMEOUT_MS` mean anything. It must also
pass `clientFactory` and `factory`: undici raises the teardown `error` on the
pooled `Client`, not on the agent that owns it, and an unhandled one ends the main
process — on a path that trips whenever the timeout does.

The retry policy cannot tell those apart. `isRetryableAssistantError` matches on
error text and that list includes `"timed out"`, so a request that sat silent for
the whole 30-minute ceiling is retried like a dropped socket, and the turn becomes
two and a half hours the user has no reason to think is still alive. Cutting the
retry count would give up the cheap retries that are the point of the policy, so
`agent/retry-budget.ts` bounds the wall clock instead: fast failures never come
near it, a hung request exhausts it on the first retry.

## The workspace is a dock, and two things hold it up

The shell used to be three hard-coded regions: one main slot showing one of six views, a
`w-72` History rail nobody could resize, and a drawer where Terminal and Preview took turns.
None of it survived a restart. It is now a **dockview** dock — panels dragged into splits and
tabs, remembered per sub-app — and `App.tsx` holds no panel state at all.

**`renderer: 'always'` is not a preference, it is the reason this library was chosen.** Every
panel is added with it, and dockview then keeps that panel's element attached to its own
`.dv-render-overlay` — absolutely positioned, `contain: layout paint` — and *repositions* the
overlay over whichever group owns the panel. Docking never re-parents the DOM. Three things
depend on that and would break silently without it:

- `PreviewPanel` hosts an Electron `<webview>`. Re-parenting one destroys and recreates its
  `WebContents`, so under any library that re-renders children into a new parent the running
  app reloads on every drag and the injected `window.__anyappInspector` is lost.
- `Chat` keeps its transcript, `isStreaming` and `pendingApproval` in component-local state and
  auto-scrolls off `scrollHeight`. Hidden panels are hidden with `visibility`, not
  `display: none`, so the box survives and auto-scroll keeps working in a background tab.
- `CodeViewer` disposes its Monaco editor *and* model on unmount, deliberately. Staying mounted
  is what keeps the undo stack, folds and scroll position.

**The dock is never unmounted while an app is focused.** The nav rail's other destinations —
Apps, Skills, Help, Settings — render as an opaque overlay *over* the workspace rather than in
place of it. Swapping it out instead would destroy the webview and drop whatever the transcript
had in flight, which is the bug the dock exists to fix: `Chat.tsx` tears down its `agent:stream`
subscription on unmount, and `ipc.ts` still carries a workaround that counts skill loads in main
because navigating to Skills used to stop the renderer receiving chunks mid-turn. That
workaround is now belt-and-braces rather than load-bearing. The dock wrapper carries `isolate`
so dockview's internal z-indexes stay under the overlay.

**The dock's box must `clip`, and `overflow-hidden` is not good enough.** A panel dockview has
not positioned yet keeps `.dv-render-overlay`'s default 100%/100% at the end of the flow, so an
unclipped wrapper counted the overlays twice over: 1436px of content in a 718px box. Nothing
draws a scrollbar for that, and the only symptom was `Chat`'s `scrollIntoView` silently
scrolling the *shell* on load — the workspace bar slid off the top of the window and the dock
under-filled it by exactly the scroll offset. Switching the wrapper to `overflow-hidden` only
moved the scroll from `main` into the wrapper, because a hidden box is still a scroll container.
Both are `overflow-clip` now, which cannot scroll at all. The shell's regions never scroll;
panels scroll inside themselves. This only reproduces at the window's launch size — any resize
re-lays out the grid and hides it — so a fix verified after a `size` command is not verified.

**Closing the last panel has to leave a way back.** `EmptyDock` is dockview's `watermarkComponent`:
it names the Panels menu and carries a Restore default layout button. Without it an emptied dock
is a black rectangle, and a dock you can empty into a dead end is one people are right not to
rearrange.

**`params` are serialized into the saved layout**, so nothing that is not a plain, stable value
can travel in them — the only one in the app is a Code panel's `path`. Everything else reaches
panels through `WorkspaceContext`, whose value must stay memoized: panels render inside
dockview's tree, not as children of whoever owns the state, so an object rebuilt each render
re-renders all of them including the transcript.

**Layouts are per app and deliberately not in the app.** `.anyapp-meta.json` is the obvious home
and the wrong one — it is absent from `DEFAULT_GITIGNORE` and `initGitRepo` adds every file, so
it is tracked and committed. In a repo where every agent write auto-commits, a layout rewritten
on each drag would mean a permanently dirty tree, commit noise, and a rollback of the *code*
also rolling back the *layout*. So `main/layout-store.ts` keeps them in `~/.anyapp/layouts.json`
beside `config.json`, keyed by app id, size-capped because the renderer is untrusted, and pruned
of dead apps whenever anything is written. A layout that is missing, corrupt, or written against
a different `LAYOUT_VERSION` falls back to the default — nobody can hand-repair that file, and a
dock that fails to build leaves the app with no UI at all.

**Every panel but Code is a singleton, and that is a constraint rather than a taste.** Each
`off*` in the preload bridge is `removeAllListeners(channel)`, so two panels subscribed to one
channel would tear down each other's stream on unmount. Code duplicates safely because it
subscribes to nothing — it fetches. Making any other panel duplicable means fixing the bridge
first. `catalog.ts` records which is which, and is kept free of React so the tests, which have no
DOM, can import it without pulling Monaco in.

One rough edge worth knowing: closing a panel makes dockview redistribute the freed space evenly
across the remaining columns, so a 260px sidebar can jump. That is `gridview.removeView`
defaulting to distribute, with no option on the public API. Drag it back, or use Reset layout.

## Skills

There are three populations, and they used to fail in complementary ways.

| Population | Lives in | Whose it is |
|---|---|---|
| Claude Code skills | `.claude/skills/` | The agent building **anyapp**. Nothing to do with the running app. |
| App skills | `<app-root>/skills/` | Pi, for one sub-app. Committed with it, so they roll back with it. |
| Workspace skills | `~/.anyapp/skills/` | Pi, offered to every app. Seeded from `docs/skills/`. |

**A skill's description and its body are paid for differently, and that is the whole
design.** The description rides in the manifest in *every* request and is the only text
the model matches a task against; the body costs nothing until the model asks for it.
The Skills page is drawn in those two registers, with a token count on each, because
nothing in the UI used to say so and skills were being written like documentation.

**Bodies arrive through `load_skill`, not `read`.** Pi renders its own manifest with each
skill's absolute `<location>` and the instruction to open it with `read`. Every workspace
skill is outside the app root, `read` is a path tool, and `checkConfinement` refuses it —
so for as long as skills existed, the model was shown a menu it was blocked from ordering
from, and no body had ever reached it. `agent/skill-tools.ts` takes a **name**, resolves
it against the two roots itself, and returns the body; there is no path argument for
confinement to refuse and no way to spell one that reaches another file. The tool is
classified with `read` in `checkPermission`, and the load is visible in the transcript,
which pointing at a path never was. `session.ts` therefore suppresses Pi's manifest
(`skillsOverride` returns no skills) and `system-prompt.ts` renders anyapp's.

**App skills win a name collision**, and the workspace copy is shown as shadowed rather
than hidden — a user looking for why their workspace skill has no effect needs to see it.
Nothing else discovers `<app>/skills/`: Pi's project scope is `.pi/skills` and
`DefaultResourceLoader` runs with `includeDefaults: false`, so the path is anyapp's to
define. The agent had already invented it, writing skills there because it is the only
place it can write, and registering them by hand in the app's `AGENTS.md`.

**Turning a skill off is real.** `SubApp.disabledSkills` is per-app, persisted in
`.anyapp-meta.json`, and a disabled skill is left out of the manifest entirely — so the
page's "N tokens in every request" drops when you turn one off. That number is the honest
answer to what a skill costs, and it is why the count is in the header.

**Seeding corrects itself.** `seedSkills` never overwrites, which is right for a file the
user edited and wrong for one anyapp shipped with a defect — `manage-versions` documented
nine `version_*` tools that have never existed, and every install kept them forever. A
body that still matches one anyapp shipped exactly (`SUPERSEDED_SEEDS`) is replaced, or
deleted where the correction is that the skill should not exist. A body that differs by
one character is left alone and flagged **Outdated** in the panel.

`docs/skills/` is the editable source; `bun run sync:skills` regenerates
`seed-content.ts` from it, and a test fails if the two drift. The content is embedded
rather than read from `docs/` at runtime because a packaged app does not ship that tree.

**A skill's identity is its directory name, never its frontmatter.** The `name:` in a
`SKILL.md` is written by whoever wrote the file — which includes the agent, under
`acceptEdits`, possibly from text it just fetched. If it were trusted, a file at
`skills/anything/SKILL.md` could declare `name: manage-versions`, shadow the workspace
skill of that name, and have `load_skill('manage-versions')` return its body — which the
prompt tells the model to follow. One auto-approved write, and every later session loads
it. `toSkill` in `packages/shared/src/skills/loader.ts` takes the directory name for
exactly this reason; do not "fix" it to prefer the frontmatter.

**Skill bodies are still an accepted residual injection surface.** They are inlined into
a tool result and the prompt tells the model to follow them, and the agent can write one
into `<app>/skills/` — so an instruction planted in a skill persists across sessions in a
way a single poisoned `web_fetch` does not. Identity spoofing is closed; provenance is
not tracked. It is mitigated the same way `web_fetch` is: every write and every load is a
visible tool call in the transcript, and the Skills panel shows the body.

## Conventions

Detailed, path-scoped guidance lives in `.claude/rules/` and loads automatically
when you open matching files. The rules that apply everywhere:

- Named exports for components and functions — not default exports
- `interface` over `type` for object shapes
- TSDoc (not JSDoc) on types, interfaces, functions, and component props
- Never `any` — use `unknown` and narrow, or define a real interface
- More than two parameters means an object parameter with a typed interface
- Component files are PascalCase (`MessageBubble.tsx`), matching their export

## Safety rules

These are not stylistic. Violating them is a security bug.

**Electron process isolation.** Every `BrowserWindow` sets
`contextIsolation: true` and `nodeIntegration: false`. Never expose raw
`ipcRenderer` — or any object that leaks the IPC event — across the context
bridge; expose narrow, named functions that unwrap the event first.

**IPC input.** Validate type and length of every argument inside
`ipcMain.handle` before acting on it. The renderer is untrusted.

**Subprocesses.** Filter sensitive environment variables (API keys, tokens)
out of the environment before spawning any child process.

**Credentials.** Store secrets with Electron's `safeStorage`, never in plain
files or `localStorage`. There are currently no secrets to store — inference is
local — so nothing in the app calls it. Reinstate it before adding any remote
provider.

**Self-modification.** Pi ships no sandbox: its built-in tools resolve `~` and
absolute paths and run with the process's permissions. Confinement to the active
sub-app root therefore lives in the `tool_call` handler in
`apps/electron/src/main/agent/permission-gate.ts`, which is the *only* boundary
between the model and the filesystem. Path arguments are resolved the way Pi
will resolve them and rejected if they land outside the root; shell commands are
checked against a blocklist and scanned for literal out-of-root paths, including
relative traversal. That scan is best-effort — variable expansion defeats it —
which is why `bash` is never auto-approved outside `bypassPermissions`. Nothing
bypasses the permission mode.

**The root itself is validated, not just the paths measured against it.** Every check
above asks whether a path is inside `SubApp.path` — so that value is the one input the
whole boundary rests on, and it is built by joining an app id onto `~/.anyapp/apps`. The
id arrives from the renderer through `apps:set-active`, `apps:get`, `apps:delete` and
`apps:update`, and `join` resolves `../../../tmp` without complaint. `isValidAppId` and
`AppManager.appDir` (`packages/shared/src/apps/manager.ts`) are therefore part of the
sandbox: an id must be one path segment, and the resolved path must be a direct child of
the apps root. This is the same reasoning as `resolveAppRoot` in `ipc.ts`, pushed down to
where the join actually happens so every caller is covered rather than one handler.

There are **two** such joins, and the second is the one that writes. `getAppPath` in
`packages/shared/src/chat/session-paths.ts` builds the same path independently, and
`ChatHistoryManager.writePointer` and `createSession` `mkdir -p` it and write into it —
so it carries the same guard. A third place that turns an id into a path has to as well;
the rule is that an app id is validated where it becomes a path, never at the handler
that happened to receive it.

The empty id is refused for a sharper reason than traversal. `generateId` strips
everything but `[a-z0-9-]`, so a name of `!!!` or `...` reduces to `''` — and
`join(APPS_DIR, '')` *is* `APPS_DIR`. An app created that way has every other app inside
its root, and `deleteApp` passes that path to a recursive `rm`. No attacker is needed for
that one, only a user naming an app with punctuation.

**The shell scan permits some paths outside the root.** `inspectCommand` skips a named
set: the harmless device files (`/dev/null` and friends), the root-owned toolchain
directories, the Homebrew prefixes, and the OS temp directory. That widens the *scan*,
not what `bash` can do — the shell resolves bare command names through `PATH` regardless,
so refusing the token `/usr/bin/sed` only ever punished the model for spelling out a path
it did not need. The old blanket refusal broke `2>/dev/null`, which a model writes
reflexively, and gave it no way to recover.

That justification covers naming a path, not writing to one, and the two Homebrew
prefixes are where the difference bites: `/usr/local` is outside SIP and `/opt/homebrew`
is the Apple Silicon prefix, so both are user-writable and both are on the `PATH` every
other program on the machine uses. A bare command name can *run* `git`; only an absolute
path can *overwrite* it. So those two may be named and not written —
`inspectToolchainWrites` refuses a redirect into them or a file-writing command aimed at
them. Writes into `/dev/` are still refused for anything but the device files. Everything genuinely worth refusing — `/etc`, `~/.ssh`, a sibling app root,
`../..` — is untouched, and an absolute path *in quotes* is now refused too: the
tokenizer never looked inside quotes, so `cat "/etc/passwd"` had been passing the scan
for as long as the scan existed.

**Pi's context-file discovery is confined.** Pi looks for `AGENTS.md` and `CLAUDE.md` by
walking *up* from `cwd` and also reads `agentDir`. Sub-apps live under `~/.anyapp/apps/`,
so without `agentsFilesOverride` a file at `~/.anyapp/AGENTS.md` or `~/AGENTS.md` entered
every session's prompt: unbounded text against a 32k window, invisible in the UI, and
describing a different project. `agent/context-files.ts` filters that list through
`isWithinRoot`. A sub-app's own `AGENTS.md` still works; only the ancestry is dropped.

**Network access is not confined.** There is deliberately no host allowlist:
`web_fetch` can reach `localhost`, the LAN, and link-local metadata addresses.
`checkConfinement` validates only that the URL is well-formed `http(s)`. `bash`
reaches the network too and always has — `curl` was never in the blocklist —
so `describeNetworkUse` annotates such commands for the approval prompt. That
annotation is legibility, not enforcement: it refuses nothing, and under
`bypassPermissions` a `bash curl` still runs unwatched.

## Permission modes

| Mode | Behavior |
|------|----------|
| `plan` | No side effects. Reads, searches, git inspection and `web_fetch`; nothing may change. |
| `default` | Prompt the user for approval on each tool use. |
| `acceptEdits` | Auto-approve file operations and version tools. |
| `bypassPermissions` | Auto-approve everything. Use with caution. |

**What `plan` allows** is `PLAN_READ_TOOLS` — `read`, `grep`, `find`, `ls`,
`load_skill`, `code_intel`, `git_status`, `get_history`, `list_branches` — plus
`web_fetch`. None of
them can write a file, run a command, or move HEAD. `create_branch`, `switch_branch`, `rollback` and
`refactor` are deliberately absent: they change the app even though, for the first three,
nothing is written.
`bash` is absent because it is not a read tool however read-only the command looks — the
scan that would decide that is best-effort.

The mode denied *everything* but `web_fetch` for a long time, while the UI called it
**Explore** and promised "Reads files. Changes nothing." The code was the thing that was
wrong; a planning mode that cannot read the code it is planning against has no use.

Anything unclassified still falls through to a denial, so a tool added later cannot
inherit read access by accident.

Four tools need more than the table says:

**`web_fetch` runs in `plan` and never prompts outside `default`.** It issues a GET with
no request body, so it cannot write a file, run a command, or modify the app. This holds
only while the tool stays GET-only; a `method` or `body` parameter would have to change
`checkPermission` with it.

That is narrower than "it only reads". The model controls the whole URL, so a
GET's query string carries data *out*: with no host policy and no prompt in
`plan` or `acceptEdits`, a fetch can exfiltrate anything already in context — and
since `plan` now reads files, "in context" reaches any file in the app root. That
is an accepted residual risk and allowing reads widened it, mitigated only by
every call and its URL being visible in the transcript. A host allowlist on
`web_fetch` is the thing that would close it.

`load_skill` is classified with the file tools rather than given an entry of its own:
it opens one file the user placed in their own skills directory, which is what `read`
does. It is the tool that *replaced* pointing the model at that file's path and having
the gate refuse it, so treating it more strictly would restore the original bug.

**MCP source tools are the exception to `acceptEdits`**: they always prompt
outside `bypassPermissions`, and `plan` denies them outright. Path confinement
cannot reach inside a separate server process, so approval is their only
boundary — and a tool anyapp cannot inspect cannot be called read-only.

**`install_deps` is the other**, for the same reason `bash` is. Its command is
fixed (`bun install`), which looks safe but is not: `bun` runs the project's own
`preinstall` and `postinstall` scripts, and in `acceptEdits` the agent can
already write `package.json` unprompted. Auto-approving the install would hand
the model unprompted arbitrary shell in two innocuous-looking steps.

## Version control

Versioning uses isomorphic-git (`packages/shared/src/versions/`). Every
successful `write` or `edit` auto-commits, via the `tool_result` handler in
`apps/electron/src/main/agent/auto-commit.ts`, when the `autoCommit` setting is
on. Create branches for experiments, roll back to any commit, merge what works.

New sub-apps are seeded with a `.gitignore` (`DEFAULT_GITIGNORE` in
`packages/shared/src/apps/templates.ts`). That is a context measure, not a
tidiness one: `statusMatrix` reports untracked files as modified, so without it
the first `git_status` after an `install_deps` answers with every path under
`node_modules/` — hundreds of kilobytes, more than the whole window.

Chat history is Pi's own tree-structured JSONL transcript, stored under
`~/.anyapp/pi/sessions/`, adapted to the app's types by
`packages/shared/src/chat/manager.ts`.

## Where things live

| Location | What it is |
|----------|------------|
| `.claude/rules/` | Path-scoped conventions. Load when matching files are opened. |
| `.claude/skills/` | On-demand workflows (`/session-plan`, `/session-notes`) and reference material. |
| `.claude/agents/` | Read-only review subagents for Electron security and the agent tool surface. |
| `docs/plans/` | One document per implementation session, plus notes. See `docs/plans/README.md`. |
| `docs/skills/` | **anyapp's own runtime skills** — app content, not Claude Code skills. See below. |

`docs/skills/*/SKILL.md` are the editable source for the skills the *running app*
seeds into `~/.anyapp/skills`. They are application domain content. Do not move or
edit them when the task is about configuring Claude Code — that lives in `.claude/`.

## Config location

User data is stored at `~/.anyapp/` — sub-apps, skills, sources, chat history.
