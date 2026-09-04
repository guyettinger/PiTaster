# Session 6.6 Notes: Integration

## Completed

- [x] Added imports for `AppListing`, `AppHeader`, `NoAppSelected`, and `SubApp` type
- [x] Added 'apps' to `MainPanel` type, defaulting to 'apps' view on startup
- [x] Added `activeApp` state with restore on mount via `getActiveAppDetails()`
- [x] Extended `NavButton` with `disabled` and `badge` props
- [x] Added `handleAppSelect` and `handleBackToApps` lifecycle handlers
- [x] Updated version control handlers to pass `activeApp.path` and refresh app state
- [x] Added Apps navigation button in sidebar
- [x] Disabled right panel buttons when no app is active
- [x] Added `AppHeader` above chat when app is active
- [x] Added conditional rendering for `AppListing`, `Chat`, and `NoAppSelected`
- [x] Added `appPath` prop to `VersionControl` component
- [x] Updated `loadVersionData` to use `appPath` for all IPC calls
- [x] Updated all version control handlers to pass `appPath` to IPC calls
- [x] `bun run typecheck:all` passes

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/renderer/src/App.tsx` | Added imports, activeApp state, app lifecycle handlers, updated navigation and content rendering |
| `apps/electron/src/renderer/src/components/VersionControl.tsx` | Added appPath prop, updated all IPC calls to pass appPath |

## App.tsx Changes

### New Imports

```typescript
import { AppListing } from './components/AppListing'
import { AppHeader } from './components/AppHeader'
import { NoAppSelected } from './components/NoAppSelected'
import type { SubApp } from '@pitaster/core'
```

### Updated State

```typescript
const [mainPanel, setMainPanel] = useState<MainPanel>('apps')  // Default to apps
const [activeApp, setActiveApp] = useState<SubApp | null>(null)
```

### New Lifecycle Handlers

```typescript
const handleAppSelect = useCallback(async (app: SubApp) => {
  setActiveApp(app)
  await window.electronAPI.setActiveApp(app.id)
  setMainPanel('chat')
}, [])

const handleBackToApps = useCallback(async () => {
  setActiveApp(null)
  await window.electronAPI.setActiveApp(null)
  setMainPanel('apps')
  setRightPanel(null)
}, [])
```

### Updated Version Control Handlers

```typescript
const handleVersionRollback = useCallback(async (commitId: string) => {
  if (!activeApp) return
  await window.electronAPI.rollback(commitId, activeApp.path)
  const updated = await window.electronAPI.getApp(activeApp.id)
  if (updated) setActiveApp(updated)
}, [activeApp])
```

### NavButton Enhancement

```typescript
function NavButton({ icon, label, active, onClick, badge, disabled }: {
  // ...
  badge?: string
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      className={`... ${
        disabled ? 'cursor-not-allowed text-neutral-600' : ...
      }`}
    >
      {icon}
      {badge && <span className="...">{badge}</span>}
    </button>
  )
}
```

## VersionControl.tsx Changes

### Updated Props Interface

```typescript
interface VersionControlProps {
  isVisible: boolean
  appPath: string  // NEW - required
  onRollback: (commitId: string) => void
  onBranchSwitch: (branchName: string) => void
  onBranchCreate: (name: string) => void
}
```

### Updated IPC Calls

```typescript
// Before
window.electronAPI.getVersionState()
window.electronAPI.getBranches()
window.electronAPI.getHistory(20)
window.electronAPI.switchBranch(branchName)
window.electronAPI.createBranch(newBranchName)
window.electronAPI.rollback(commitOid)

// After
window.electronAPI.getVersionState(appPath)
window.electronAPI.getBranches(appPath)
window.electronAPI.getHistory(20, appPath)
window.electronAPI.switchBranch(branchName, appPath)
window.electronAPI.createBranch(newBranchName, appPath)
window.electronAPI.rollback(commitOid, appPath)
```

## User Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Apps      │ ──→  │   Chat      │ ──→  │  Version    │
│   Panel     │      │ (scoped)    │      │  Control    │
└─────────────┘      └─────────────┘      └─────────────┘
     │                     │                    │
     ▼                     ▼                    ▼
 Create/Delete        Agent works          Branches,
 Select app           on active app        Rollback
```

## Navigation States

| State | Apps Button | Chat Button | Right Panels |
|-------|-------------|-------------|--------------|
| No app selected | Active | Shows NoAppSelected | Disabled |
| App selected | Available | Shows Chat | Enabled |

## Verification Checklist

- [x] App navigation works (Apps → Chat → Apps)
- [x] Active app persists across navigation
- [x] Right panels only show when app active
- [x] Version control uses correct app path
- [x] Chat requires app selection
- [x] `bun run typecheck:all` passes

## Session 6 Complete

All sub-sessions are now complete:

- [x] 6.1: Types and AppManager base
- [x] 6.2: App templates
- [x] 6.3: App listing UI
- [x] 6.4: IPC integration
- [x] 6.5: Agent scoping
- [x] 6.6: Integration

The sub-apps architecture is fully integrated with:
- Immutable outer container
- Sandboxed sub-apps in `~/.pitaster/apps/`
- Per-app git versioning
- Agent tools scoped to active app
- Path traversal prevention
- 5 app templates available
