# Session 8.5 Notes: App Controls and Status Indicators

## Summary

Added run/stop controls and status indicators to `AppControls`, `AppCard`, and `AppHeader` components, integrating with the existing `RunningAppsContext`.

## Files Created

| File | Purpose |
|------|---------|
| `apps/electron/src/renderer/src/components/AppControls.tsx` | Reusable toolbar component |

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/renderer/src/components/AppListing.tsx` | Added running indicators and run/stop controls to `AppCard` |
| `apps/electron/src/renderer/src/components/AppHeader.tsx` | Added status badge and run controls |

## Implementation Details

### AppControls.tsx

New reusable toolbar component with:
- Status indicator (colored dot: green=running, yellow=starting, red=error)
- Run/Stop button (conditional based on running state)
- Open in browser button (when running with URL)
- Install dependencies button (when not running)
- Size variants (`sm`/`md`) and optional labels
- Runnable templates: `react-vite`, `node-server`, `node-cli`, `static-site`

### AppCard Updates

- Added `useRunningApps` hook integration
- Running status dot displayed next to app name
- Quick run/stop buttons in card actions
- Delete button disabled while app is running (with tooltip explaining why)
- Port number displayed in footer when app is running

### AppHeader Updates

- Added `useRunningApps` hook integration
- Status badge pill showing current status and port when running
- Run/Stop button in header actions
- "Open in Browser" button when app is running with URL
- Branch info moved to badge style

## Verification

- `bun run typecheck:all` passes
- No linter errors
- All components properly consume `RunningAppsContext`

## Next Steps

Proceed to **SESSION-8.6-LAYOUT-INTEGRATION.md** for the final layout integration.
