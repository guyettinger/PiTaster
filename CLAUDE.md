# anyapp - Self-Modifying Electron App

## Project Overview

anyapp is a self-modifying Electron app built with Claude Agent SDK. The agent can read and modify its own source code with full version control.

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

User data stored at `~/.anyapp/`
