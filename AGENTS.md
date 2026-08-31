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
gate, path confinement, git auto-commit, its own version-control and network
tools, and a bridge that exposes connected MCP sources' tools as
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
| `plan` | No side effects. Reads and `web_fetch` only; nothing may change. |
| `default` | Prompt the user for approval on each tool use. |
| `acceptEdits` | Auto-approve file operations and version tools. |
| `bypassPermissions` | Auto-approve everything. Use with caution. |

Three tools sit outside that table:

**`web_fetch` is the one `plan` exception.** It issues a GET with no request
body, so it cannot write a file, run a command, or modify the app — which is what
`plan` promises — and it is allowed wherever `read` is. This holds only while the
tool stays GET-only; a `method` or `body` parameter would have to change
`checkPermission` with it.

That is narrower than "it only reads". The model controls the whole URL, so a
GET's query string carries data *out*: with no host policy and no prompt in
`plan` or `acceptEdits`, a fetch can exfiltrate anything already in context. That
is an accepted residual risk, mitigated only by every call and its URL being
visible in the transcript.

**MCP source tools are the exception to `acceptEdits`**: they always prompt
outside `bypassPermissions`. Path confinement cannot reach inside a separate
server process, so approval is their only boundary.

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

`docs/skills/*/SKILL.md` are seed copies of the skills the *running app* loads
for its agent, via `SkillsLoader` from `~/.anyapp/skills`
(`packages/shared/src/skills/loader.ts`). They are application domain content.
Do not move or edit them when the task is about configuring Claude Code — that
lives in `.claude/`.

## Config location

User data is stored at `~/.anyapp/` — sub-apps, skills, sources, chat history.

`~/.anyapp/skills` is **seeded on first run** from `packages/shared/src/skills/seed-content.ts`,
which embeds the `docs/skills/*/SKILL.md` bodies as constants. Before that it was read by
the agent and by the Skills panel and written by neither, so a fresh install ran with no
skills at all — including `working-notes`, which is the `NOTES.md` convention the
post-compaction nudge sends the model to read. The content is embedded rather than copied
out of `docs/` because a packaged app does not ship the repository's `docs/` tree, so
reading from it would work in development and fail silently in a build. Seeding never
overwrites an existing skill; the Skills panel edits are the user's.
