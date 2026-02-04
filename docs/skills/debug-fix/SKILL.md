---
name: debug-fix
description: Debug issues and fix bugs in Anyapp. Use when user reports errors or unexpected behavior.
---

# Debugging

## Diagnostic Steps

1. Check error stack traces carefully
2. Identify affected module (main/preload/renderer/shared)
3. Check IPC communication if cross-process issue
4. Verify permission mode if tool execution fails
5. Create minimal reproduction before fixing
6. Test fix thoroughly

## Common Issues

### IPC Errors
- Check handler exists in `ipc.ts`
- Verify preload exposes the method
- Check argument types match

### Type Errors
- Run `bun run typecheck:all`
- Check imports from @anyapp/core
- Verify workspace dependencies

### Runtime Errors
- Check Electron console (main process)
- Check DevTools console (renderer)
- Look for async/await issues

## Debug Commands

```bash
# Type check entire monorepo
bun run typecheck:all

# Build packages
bun run build

# Check specific package
bun run --filter @anyapp/shared typecheck
```

## Rollback

If a fix introduces more issues:
1. Use version_history to find last good commit
2. Use version_rollback to restore
3. Analyze what went wrong before retrying
