---
name: self-modify
description: Modify the Anyapp app's own source code safely. Use when the user wants to change app behavior, add features, or fix bugs.
---

# Self-Modification

When modifying Anyapp's source code:

1. Read the current file before modifying
2. Make incremental changes, not wholesale rewrites
3. Preserve existing imports and type safety
4. Run typecheck after changes
5. If build fails, analyze and fix or rollback
6. Notify user before restarting

## Safety

- All changes are auto-committed to git
- Use version_history to see recent changes
- Use version_rollback to undo mistakes
- Create a branch for risky experiments

## Architecture

- `apps/electron/` - Electron desktop app
  - `src/main/` - Main process (Node.js)
  - `src/preload/` - Context bridge
  - `src/renderer/` - React UI
- `packages/core/` - Shared TypeScript types
- `packages/shared/` - Business logic

## Best Practices

- Follow existing patterns in the codebase
- Use TSDoc comments for documentation
- Maintain type safety - avoid `any`
- Test changes before committing
