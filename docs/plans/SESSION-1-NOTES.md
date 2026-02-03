# Session 1: Implementation Notes

These notes capture learnings and adjustments made during the Session 1: Foundation implementation.

## Environment Setup

### Bun Installation
- Bun was not pre-installed on the system
- Installed via: `curl -fsSL https://bun.sh/install | bash`
- After installation, bun is available at `~/.bun/bin/bun`
- The PATH update requires a new shell session, so use full path initially

### Running Commands
- Root package.json scripts use `bun run --filter` which requires bun in PATH
- Workaround: Run commands directly from workspace directory using full bun path
- Example: `~/.bun/bin/bun run dev` from `apps/electron/`

## electron-vite Configuration

### Output Directory
- **Issue**: electron-vite outputs to `out/` by default, not `dist/`
- **Fix**: Updated `apps/electron/package.json` main field from `dist/main/index.js` to `out/main/index.js`
- The `electron.vite.config.ts` doesn't need to specify output directory - default `out/` works

### Build Order
electron-vite builds in this order:
1. Main process → `out/main/index.js`
2. Preload scripts → `out/preload/index.js`
3. Renderer dev server → `http://localhost:5173/`
4. Electron app starts

## Dependencies

### Actual Versions Installed
```
bun v1.3.8
typescript@5.9.3
vite v6.4.1
306 packages total
```

### Peer Dependency Warning
- Warning about incorrect peer dependency for `vite@6.4.1`
- Does not affect functionality

## File Structure Adjustments

### Removed Files
- `/src/index.ts` - Old placeholder file
- `/package-lock.json` - Replaced by `bun.lock`

### Created Directories
```
.cursor/rules/           # 9 rule files
apps/electron/
├── src/main/
├── src/preload/
└── src/renderer/src/
    ├── styles/
    └── types/
packages/core/src/
packages/shared/src/
```

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| `bun install` | Pass | 306 packages, 25s |
| `bun run dev` | Pass | Electron window opens |
| React component renders | Pass | Counter button works |
| 9 Cursor rules exist | Pass | All in `.cursor/rules/` |
| CLAUDE.md exists | Pass | At project root |
| packages/core/src/index.ts | Pass | Empty export |
| packages/shared/src/index.ts | Pass | Empty export |

## Tips for Future Sessions

1. **Always use full bun path** until PATH is updated in shell config
2. **Check electron-vite output** - it uses `out/` not `dist/`
3. **Run dev from apps/electron/** directory for now until root scripts work
4. **Tailwind v4** uses `@import "tailwindcss"` syntax in CSS

## Commands Reference

```bash
# Install dependencies
~/.bun/bin/bun install

# Run dev (from apps/electron directory)
cd apps/electron && ~/.bun/bin/bun run dev

# Or after PATH update, from root:
bun run dev
```

## Next Session Preparation

Session 2: Agent Core will need:
- `@anthropic-ai/claude-agent-sdk` package
- `zod` for schema validation
- IPC handlers in main process
- Agent streaming to renderer
