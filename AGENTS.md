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
  *sent*: long tool results truncated with a pointer to re-read, files read twice
  collapsed to the newer read, screenshots older than two turns dropped. The
  transcript, git history and chat UI keep everything.
- **Tool profiles** (`resolveToolNames`) drop the branch tools on a small window.
  Every tool's schema is a per-request cost, and a long list makes a small model
  choose worse.
- **`agent/loop-guard.ts`** soft-blocks a third consecutive identical tool call,
  telling the model to change approach rather than burn the window repeating.

## What the user sees while waiting

Pi emits compaction, retry and settle events; `agent/events.ts` maps them to
`StreamChunk` `status` so the UI can say what is happening. Prefill has no event
— nothing happens during it — so silence longer than 20s is timed from outside
and reported with an elapsed count. Tool approval prompts have no timeout: a turn
takes minutes, and a timeout does not fail safe, it silently denies.

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
