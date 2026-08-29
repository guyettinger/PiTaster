# anyapp

Self-modifying Electron desktop app. The agent reads and writes its own source
code — and the source of sandboxed sub-apps it creates — with every write
auto-committed to git so any change can be rolled back.

The agent is built directly on the Anthropic Messages API: `@anthropic-ai/sdk`
with ~25 hand-rolled tools defined in `apps/electron/src/main/agent.ts`. It does
**not** use `@anthropic-ai/claude-agent-sdk`.

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
files or `localStorage`.

**Self-modification.** File writes are scoped to the active sub-app root and
must pass through path-traversal normalization. Shell commands are checked
against a blocklist. Nothing bypasses the permission mode.

## Permission modes

| Mode | Behavior |
|------|----------|
| `plan` | Read-only. No modifications allowed. |
| `default` | Prompt the user for approval on each tool use. |
| `acceptEdits` | Auto-approve file operations. |
| `bypassPermissions` | Auto-approve everything. Use with caution. |

## Version control

Versioning uses isomorphic-git (`packages/shared/src/versions/`). Every
`write_source` auto-commits. Create branches for experiments, roll back to any
commit, merge what works.

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
