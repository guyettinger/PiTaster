# anyapp

**A desktop app that builds apps — and rewrites its own source — with a coding
agent that never leaves your machine.**

anyapp is an Electron app with a coding agent living inside it. You describe what
you want in a chat panel; the agent reads and writes real source files on disk,
runs the dev server, and shows you the result in a preview pane docked under the
conversation. Every file it writes becomes a git commit, so anything it does can
be undone.

The agent is [Pi](https://pi.dev/) running on [Ollama](https://ollama.com). There
is no API key, no account, and no inference request that leaves your machine.

![The anyapp workspace: the agent's transcript above, the app it is editing running live below](docs/images/workspace.png)

---

## What it actually does

**It builds sandboxed sub-apps.** Each one is a real project on disk in
`~/.anyapp/apps/<name>`, with its own git repository — scaffolded from React +
Vite, Node CLI, Node server, static site, or blank. The agent is confined to the
open app's directory; it cannot read or write outside it.

![The apps list](docs/images/apps.png)

**You see it run.** Start the dev server from the header, and the app appears in
a preview panel below the chat. Click *Inspect*, then click any element on the
page, and that element — its markup, styles, and a screenshot of it — is attached
to your next message. "Make this button bigger" becomes a well-specified request.

**Every tool call is gated.** The agent asks before it reads, writes, or runs
anything. You approve inline, in the transcript, without leaving the chat.

![An approval prompt for a file read, inline in the transcript](docs/images/approval.png)

Four modes control how much it asks:

| Mode | Behavior |
|------|----------|
| **Explore** | Read-only. Nothing is modified. |
| **Ask to edit** | Prompt for approval on every tool use. |
| **Auto edit** | Auto-approve file operations; still prompt for shell commands. |
| **Auto — all** | Auto-approve everything. Use with caution. |

**Nothing is unrecoverable.** Every `write` and `edit` auto-commits. The History
panel is the app's own git log: browse it, roll back to any commit, branch off to
try something risky, merge what works.

![The History panel showing one commit per agent edit](docs/images/history.png)

**Skills are reusable instructions.** Drop a `SKILL.md` in `~/.anyapp/skills/`
and hand it to the agent with an `@mention`. Six ship by default, covering
self-modification, debugging, UI work, versioning, connecting sources, and
writing new skills.

![The Skills panel](docs/images/skills.png)

**It connects to MCP servers.** Add a source in Settings and its tools appear to
the agent as `mcp__<source>__<tool>`. Those always prompt for approval —
path confinement can't reach inside someone else's server process, so your
approval is the only boundary.

**And it modifies itself.** The same agent that builds sub-apps can be pointed at
anyapp's own source. That's the whole point of the name.

---

## Getting started

You need [Bun](https://bun.sh), [Ollama](https://ollama.com), and a model that
supports **tool calling**. A model without tool support will connect and then be
unable to do anything.

```bash
# 1. Start Ollama and pull a tool-calling model
ollama serve
ollama pull qwen3-coder:30b     # or llama3.1, gpt-oss, mistral-nemo

# 2. Install and run anyapp
bun install
bun run dev
```

Then open **Settings → General** and pick your model. anyapp discovers whatever
the daemon is serving.

![Settings, showing the Ollama server and model picker](docs/images/settings.png)

> Electron 39+ is required — Pi needs Node ≥ 22.19. Your data lives in
> `~/.anyapp/` (sub-apps, skills, sources, chat history).

### Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Start the app with hot reload |
| `bun run build` | Build all packages |
| `bun run typecheck:all` | Type check the entire monorepo |

`bun run typecheck:all` is the gate the self-modification flow relies on. Run it
after changing any source file.

---

## How it's put together

A Bun workspace monorepo:

| Path | Package | Contents |
|------|---------|----------|
| `apps/electron/` | `@anyapp/electron` | The desktop app |
| `packages/core/` | `@anyapp/core` | Shared TypeScript types only |
| `packages/shared/` | `@anyapp/shared` | Apps, chat, skills, sources, versions, inspector |

`apps/electron/` follows the electron-vite convention — `src/main/` (Node.js),
`src/preload/` (the context bridge, the only channel between the two), and
`src/renderer/` (React 19, Vite, Tailwind v4).

Pi owns the agent loop, the built-in tools (`read`, `write`, `edit`, `bash`,
`grep`, `find`, `ls`), and the session transcript. anyapp layers on the
permission gate, path confinement, git auto-commit, its own version-control
tools, and the MCP bridge.

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Desktop | Electron 39 + electron-vite |
| UI | React 19 + Tailwind v4 |
| Agent | Pi (`@earendil-works/pi-coding-agent`) on Ollama |
| Version control | isomorphic-git |
| Sources | MCP TypeScript SDK v1.x |

### The security boundary

Pi ships no sandbox — its tools resolve `~` and absolute paths and run with the
process's permissions. Confinement lives in one place:
[`apps/electron/src/main/agent/permission-gate.ts`](apps/electron/src/main/agent/permission-gate.ts).
It resolves path arguments the way Pi will resolve them and rejects anything
landing outside the open app's root; shell commands are checked against a
blocklist and scanned for out-of-root paths. That scan is best-effort — variable
expansion defeats it — which is why `bash` is never auto-approved outside
*Auto — all*.

---

## Documentation

| Document | What's in it |
|----------|--------------|
| [AGENTS.md](AGENTS.md) | Architecture, conventions, and safety rules — start here |
| [CLAUDE.md](CLAUDE.md) | Claude Code–specific workflow on top of `AGENTS.md` |
| [docs/plans/README.md](docs/plans/README.md) | Index of every implementation session, with status |
| [docs/plans/FULL-PLAN.md](docs/plans/FULL-PLAN.md) | The original comprehensive plan |
| [.claude/rules/](.claude/rules/) | Path-scoped conventions (TypeScript, React, Electron security, MCP, self-modification, docs) |
| [.claude/agents/](.claude/agents/) | Read-only review subagents for Electron security and the agent's tool surface |
| [docs/skills/](docs/skills/) | anyapp's **runtime** skills — seed content for `~/.anyapp/skills`, not Claude Code skills |

The project was built in numbered sessions; each has a plan document and a notes
document recording what was actually built. [Session
17](docs/plans/SESSION-17-NOTES.md) covers the current shell design and visual
identity, and [Session 15](docs/plans/SESSION-15-NOTES.md) the move from a
hand-rolled Anthropic loop to Pi on local models.

---

## License

[MIT](LICENSE) © Guy Ettinger
