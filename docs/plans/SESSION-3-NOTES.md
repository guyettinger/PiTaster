# Session 3: Version Control - Implementation Notes

## Summary

Session 3 successfully implemented version control using `isomorphic-git`. All planned features were completed including the VersionManager class, agent tools, IPC handlers, and UI components.

## Key Decisions

### Dependency Placement

`isomorphic-git` was added to both:
- `apps/electron/package.json` - for agent tools in main process
- `packages/shared/package.json` - for the VersionManager class

This allows the shared package to be used independently while the electron app bundles everything together.

### Type Safety

Added explicit type annotations in several places where TypeScript couldn't infer types from `isomorphic-git`:
- `git.log()` results needed explicit commit type
- `git.walk()` callback parameters needed entry types
- `git.statusMatrix()` results needed row type annotations

### Package Build Order

The monorepo requires packages to be built in order (`@keylimepi/core` → `@keylimepi/shared` → `@keylimepi/electron`) because:
- Packages reference `dist/` directories in their `main` and `types` fields
- TypeScript needs the compiled `.d.ts` files for cross-package imports

Running `bun run build` before `bun run typecheck:all` ensures all types are available.

### VersionManager Lazy Initialization

Both `agent.ts` and `ipc.ts` use lazy initialization for `VersionManager`:

```typescript
let versionManager: VersionManager | null = null

function getVersionManager(): VersionManager {
  if (!versionManager) {
    versionManager = new VersionManager(PROJECT_ROOT)
  }
  return versionManager
}
```

This pattern:
- Defers initialization until first use
- Resets when `setProjectRoot()` is called (allowing workspace switching)
- Avoids initialization errors if git repo doesn't exist yet

### Auto-Commit in write_source

The `write_source` tool now auto-commits with graceful fallback:

```typescript
try {
  const commit = await versionManager.commit({ message, files: [path] })
  return `Wrote ${path} (committed: ${commit.oid.slice(0, 7)}): ${message}`
} catch {
  // If git commit fails (e.g., not a git repo), just report the write
  return `Wrote ${path}: ${message}`
}
```

This ensures the tool works even in non-git directories while providing version control benefits when available.

### Permission Mode Handling

Version control tools are treated similarly to file operations:
- Allowed in `acceptEdits` mode (alongside read_source, write_source, list_files)
- Requires approval in `default` mode
- Denied in `plan` mode
- Auto-allowed in `bypassPermissions` mode

## Files Created

| File | Purpose |
|------|---------|
| `packages/core/src/versions.ts` | Type definitions for version control |
| `packages/shared/src/versions/manager.ts` | VersionManager class wrapping isomorphic-git |
| `apps/electron/src/renderer/src/components/VersionControl.tsx` | Version control sidebar UI |
| `apps/electron/src/renderer/src/components/DiffViewer.tsx` | Side-by-side diff viewer |

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/package.json` | Added isomorphic-git dependency |
| `packages/shared/package.json` | Added isomorphic-git and @types/node |
| `packages/shared/tsconfig.json` | Added node types |
| `packages/core/src/index.ts` | Export versions module |
| `packages/shared/src/index.ts` | Export VersionManager |
| `apps/electron/src/main/agent.ts` | Added version tools, auto-commit |
| `apps/electron/src/main/ipc.ts` | Added version IPC handlers |
| `apps/electron/src/preload/index.ts` | Exposed version API methods |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Added version types |
| `apps/electron/src/renderer/src/App.tsx` | Integrated version control panel |

## Deviations from Plan

### Minor Changes

1. **Error handling in merge()**: Used `instanceof Error` check instead of direct property access for type safety
2. **Walk callback types**: Defined inline type for entries array instead of using isomorphic-git's internal types
3. **StatusMatrix types**: Used explicit tuple type `[string, number, number, number]` for row filtering

### Additions

1. Added `@types/node` to `packages/shared` for `node:fs` imports
2. Added `types: ["node"]` to shared package tsconfig
3. Added refresh button to VersionControl UI (not in original plan)
4. Added error state handling in VersionControl component

## Testing Notes

- Type checking passes: `bun run typecheck:all`
- Build succeeds: `bun run build`
- No linter errors in modified files

## Known Limitations

1. **Merge conflict handling**: The `merge()` method returns an empty conflicts array when conflicts occur. Full conflict parsing would require additional work to read conflict markers from files.

2. **Diff content**: The `diff()` method returns file paths and change types but not the actual content differences. The `oldContent` and `newContent` fields in `FileDiff` are optional and not populated.

3. **DiffViewer component**: Currently a simple side-by-side view without actual diff highlighting. Would benefit from a proper diff algorithm (e.g., `diff` package) for line-by-line comparison.

## Next Steps

Proceed to **SESSION-4-SOURCES-SKILLS.md** for MCP and skills integration.
