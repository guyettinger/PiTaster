# Session 1: Foundation + Rules

## Overview

This session establishes the project foundation: monorepo structure, Electron app shell, and all Cursor rules for consistent AI guidance throughout development.

**Estimated scope**: Small-Medium  
**Prerequisites**: None (starting from scratch)  
**Deliverable**: Working Electron app shell with all coding standards in place

## Objectives

1. Set up Bun monorepo with workspace structure
2. Configure electron-vite with React and shadcn/ui
3. Create all 9 Cursor rules
4. Create CLAUDE.md project documentation
5. Verify app launches successfully

## Parallel Subagent Strategy

```
Main Agent (orchestrator)
├── Subagent A: Monorepo + electron-vite setup
├── Subagent B: Create all 9 Cursor rules
└── Main Agent: CLAUDE.md, integration verification
```

---

## Part 1: Monorepo Setup (Subagent A)

### Tasks

1. **Initialize Bun workspace** at project root

```json
// package.json
{
  "name": "clirabbit",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter @clirabbit/electron dev",
    "build": "bun run --workspaces build",
    "typecheck:all": "bun run --workspaces typecheck"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

2. **Create packages/core** - Shared TypeScript types

```
packages/core/
├── src/
│   └── index.ts
├── package.json
└── tsconfig.json
```

3. **Create packages/shared** - Business logic (empty structure for now)

```
packages/shared/
├── src/
│   └── index.ts
├── package.json
└── tsconfig.json
```

4. **Create apps/electron** - Electron app with electron-vite

```
apps/electron/
├── src/
│   ├── main/
│   │   └── index.ts
│   ├── preload/
│   │   └── index.ts
│   └── renderer/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   └── styles/
│       │       └── globals.css
│       └── index.html
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

### Dependencies for apps/electron

```json
{
  "name": "@clirabbit/electron",
  "version": "0.1.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clirabbit/core": "workspace:*",
    "@clirabbit/shared": "workspace:*"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "latest",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "latest",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "latest",
    "typescript": "^5.5.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

### electron.vite.config.ts

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
```

### Verification

- Run `bun install` from root
- Run `bun run dev` - Electron app should launch
- Window shows basic React component

---

## Part 2: Cursor Rules (Subagent B)

Create all 9 rules in `.cursor/rules/`:

### Rules to Create

| # | File | Description |
|---|------|-------------|
| 1 | `project-architecture.mdc` | Monorepo structure, Bun conventions (alwaysApply) |
| 2 | `electron-security.mdc` | Context isolation, IPC patterns, preload security |
| 3 | `claude-agent-sdk.mdc` | Tool creation, permissions, streaming patterns |
| 4 | `mcp-integration.mdc` | MCP client/server with isomorphic-git |
| 5 | `react-practices.mdc` | React fundamentals, shadcn/ui, Tailwind, IPC |
| 6 | `self-modification.mdc` | Safety patterns, backups, rollback |
| 7 | `typescript-practices.mdc` | TSDoc, interfaces, type organization |
| 8 | `react-query-practices.mdc` | TanStack Query patterns |
| 9 | `documentation-practices.mdc` | When/how to create docs |

### Rule Content Sources

Refer to the main plan file for full rule content:
`~/.cursor/plans/self-modifying_electron_app_*.plan.md`

---

## Part 3: CLAUDE.md (Main Agent)

Create `CLAUDE.md` at project root:

```markdown
# CLIRabbit - Self-Modifying Electron App

## Project Overview
CLIRabbit is a self-modifying Electron app built with Claude Agent SDK. The agent can read and modify its own source code with full version control.

## Architecture
- **apps/electron/**: Electron app (main, preload, renderer)
- **packages/core/**: Shared TypeScript types
- **packages/shared/**: Business logic (agent, sources, skills, permissions, versions)

## Key Commands
- `bun install`: Install all workspace dependencies
- `bun run dev`: Start development with hot reload
- `bun run build`: Build all packages
- `bun run typecheck:all`: Type check entire monorepo

## Permission Modes
- `plan`: Read-only, no modifications allowed
- `default`: Prompt for approval on each tool use
- `acceptEdits`: Auto-approve file operations
- `bypassPermissions`: Auto-approve all (use with caution)

## Version Control
Uses isomorphic-git for versioning. Every `write_source` auto-commits.
- Create branches for experiments
- Rollback to any commit
- Merge successful experiments

## Self-Modification Safety
1. All changes auto-committed to git
2. Type checking runs after modifications
3. Rollback available via version control
4. User confirmation required in default mode

## Config Location
User data stored at `~/.clirabbit/`
```

---

## Verification Checklist

- [ ] `bun install` succeeds from root
- [ ] `bun run dev` launches Electron window
- [ ] Window displays React component
- [ ] All 9 `.cursor/rules/*.mdc` files exist
- [ ] `CLAUDE.md` exists at project root
- [ ] `packages/core/src/index.ts` exists
- [ ] `packages/shared/src/index.ts` exists

## Commit Checkpoint

```bash
git add -A
git commit -m "feat: foundation setup with monorepo, electron-vite, and cursor rules

- Set up Bun workspace with apps/electron, packages/core, packages/shared
- Configure electron-vite with React 19 and Tailwind CSS v4
- Create 9 Cursor rules for coding standards
- Add CLAUDE.md project documentation
- Basic Electron app shell launches successfully"
```

---

## Next Session

Proceed to **SESSION-2-AGENT-CORE.md** for Claude Agent SDK integration.
