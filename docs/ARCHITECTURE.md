# Architecture

## The monorepo

A Bun workspace. Inter-package dependencies use `"workspace:*"`.

| Path | Package | Contents |
|------|---------|----------|
| `apps/electron/` | `@keylimepi/electron` | The desktop app |
| `packages/core/` | `@keylimepi/core` | Shared TypeScript types only |
| `packages/shared/` | `@keylimepi/shared` | Apps, chat, skills, sources, versions, inspector |

Import types from `@keylimepi/core` and business logic from `@keylimepi/shared`.
Neither package may import from `apps/electron/` — the dependency only runs one
way.

`apps/electron/` follows the electron-vite convention:

- `src/main/` — the main process (Node.js): the agent, IPC, screenshots, windows
- `src/preload/` — the context bridge, and the only channel between main and renderer
- `src/renderer/` — the React 19 UI (browser context, Vite + Tailwind v4)

## Who does what

The agent is [Pi](https://pi.dev/) (`@earendil-works/pi-coding-agent`), embedded
through its SDK in `apps/electron/src/main/agent/`.

**Pi owns** the agent loop, the built-in tools (`read`, `write`, `edit`, `bash`,
`grep`, `find`, `ls`), and the session transcript.

**Key Lime Pi adds** the permission gate, path confinement, git auto-commit, its own
version-control, network and skill tools, a TypeScript language service per
sub-app, and a bridge that exposes connected MCP sources' tools as
`mcp__<source>__<tool>`.

## The stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Desktop | Electron 39 + electron-vite |
| UI | React 19 + Tailwind v4 |
| Agent | Pi (`@earendil-works/pi-coding-agent`) on Ollama |
| Code intelligence | TypeScript language service, in a `utilityProcess` |
| Editor | Monaco (bundled, no CDN) |
| Version control | isomorphic-git |
| Sources | MCP TypeScript SDK v1.x |

## Design notes

The interesting decisions — and the bugs that produced them — are written up in
[AGENTS.md](../AGENTS.md). The sections worth reading first:

- **[The context window is not what Ollama advertises](../AGENTS.md#the-context-window-is-not-what-ollama-advertises)** — why the real window has to be discovered rather than configured
- **[Working within a small window](../AGENTS.md#working-within-a-small-window)** — compaction, context trimming, tool profiles, the loop guard
- **[Editing is where a long task actually fails](../AGENTS.md#editing-is-where-a-long-task-actually-fails)** — why `edit` fails on indentation, and the three things that address it
- **[The compiler is a tool, and mostly not one](../AGENTS.md#the-compiler-is-a-tool-and-mostly-not-one)** — the TypeScript service, and why its highest-value part isn't a tool at all
- **[Skills](../AGENTS.md#skills)** — the three skill populations and how a body actually reaches the model

## Conventions

- Named exports for components and functions — not default exports
- `interface` over `type` for object shapes
- TSDoc (not JSDoc) on types, interfaces, functions, and component props
- Never `any` — use `unknown` and narrow, or define a real interface
- More than two parameters means an object parameter with a typed interface
- Component files are PascalCase (`MessageBubble.tsx`), matching their export

Path-scoped conventions live in [`.claude/rules/`](../.claude/rules/) and load
automatically when a matching file is opened.
