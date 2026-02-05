# Session 8.5: App Controls and Status Indicators

## Overview

This sub-session adds run/stop controls and status indicators to AppCard and AppHeader components.

**Estimated scope**: Small  
**Prerequisites**: Session 8.4 complete  
**Deliverable**: Updated AppCard and AppHeader with running controls

## Objectives

1. Create AppControls toolbar component
2. Update AppCard with running indicators
3. Update AppHeader with run controls

---

## Task 1: App Controls Toolbar

### Create apps/electron/src/renderer/src/components/AppControls.tsx

```typescript
import { useCallback, useState } from 'react'
import { useRunningApps } from '../context/RunningAppsContext'
import type { AppTemplate } from '@anyapp/core'

/** Templates that can be run. */
const RUNNABLE_TEMPLATES: AppTemplate[] = ['react-vite', 'node-server', 'node-cli', 'static-site']

/**
 * Props for the AppControls component.
 */
interface AppControlsProps {
  /** App ID. */
  appId: string
  /** App template. */
  template: AppTemplate
  /** Whether to show labels. */
  showLabels?: boolean
  /** Size variant. */
  size?: 'sm' | 'md'
}

/**
 * App controls toolbar for run/stop/browser actions.
 */
export function AppControls({ appId, template, showLabels = false, size = 'md' }: AppControlsProps) {
  const { 
    isRunning, 
    getStatus, 
    getUrl, 
    startApp, 
    stopApp, 
    openInBrowser,
    installDeps 
  } = useRunningApps()
  
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const running = isRunning(appId)
  const status = getStatus(appId)
  const url = getUrl(appId)
  const isRunnable = RUNNABLE_TEMPLATES.includes(template)

  const handleRun = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setError(null)
    try {
      await startApp(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }, [appId, startApp])

  const handleStop = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setError(null)
    try {
      await stopApp(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop')
    }
  }, [appId, stopApp])

  const handleOpenBrowser = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await openInBrowser(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open browser')
    }
  }, [appId, openInBrowser])

  const handleInstall = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsInstalling(true)
    setError(null)
    try {
      await installDeps(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install')
    } finally {
      setIsInstalling(false)
    }
  }, [appId, installDeps])

  const buttonClass = size === 'sm' 
    ? 'rounded px-2 py-1 text-xs'
    : 'rounded px-3 py-1.5 text-sm'

  return (
    <div className="flex items-center gap-2">
      {/* Status indicator */}
      {status && (
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${
            status === 'running' ? 'bg-green-500' :
            status === 'starting' ? 'animate-pulse bg-yellow-500' :
            status === 'error' ? 'bg-red-500' : 'bg-neutral-500'
          }`} />
          {showLabels && (
            <span className="text-xs text-neutral-400">
              {status === 'running' && url ? `localhost:${new URL(url).port}` : status}
            </span>
          )}
        </div>
      )}

      {/* Run/Stop button */}
      {isRunnable && (
        running ? (
          <button
            onClick={handleStop}
            disabled={status === 'starting'}
            className={`${buttonClass} bg-red-600 text-white hover:bg-red-700 disabled:opacity-50`}
            title="Stop"
          >
            ⏹ {showLabels && 'Stop'}
          </button>
        ) : (
          <button
            onClick={handleRun}
            className={`${buttonClass} bg-green-600 text-white hover:bg-green-700`}
            title="Run"
          >
            ▶ {showLabels && 'Run'}
          </button>
        )
      )}

      {/* Open in browser */}
      {running && url && (
        <button
          onClick={handleOpenBrowser}
          className={`${buttonClass} bg-neutral-700 hover:bg-neutral-600`}
          title="Open in browser"
        >
          🌐 {showLabels && 'Browser'}
        </button>
      )}

      {/* Install dependencies */}
      {isRunnable && !running && (
        <button
          onClick={handleInstall}
          disabled={isInstalling}
          className={`${buttonClass} bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50`}
          title="Install dependencies"
        >
          {isInstalling ? '⏳' : '📦'} {showLabels && (isInstalling ? 'Installing...' : 'Install')}
        </button>
      )}

      {/* Error display */}
      {error && (
        <span className="text-xs text-red-400" title={error}>
          ⚠️
        </span>
      )}
    </div>
  )
}
```

---

## Task 2: Update AppCard

### Update apps/electron/src/renderer/src/components/AppListing.tsx

Add import at top:

```typescript
import { useRunningApps } from '../context/RunningAppsContext'
```

Update the `AppCard` component to show running status and disable delete while running:

```typescript
/**
 * Card displaying a single app.
 */
function AppCard({ app, isActive, onSelect, onDelete }: AppCardProps) {
  const { isRunning, getStatus, getUrl, startApp, stopApp } = useRunningApps()
  
  const running = isRunning(app.id)
  const status = getStatus(app.id)
  const url = getUrl(app.id)

  const templateIcons: Record<AppTemplate, string> = {
    'react-vite': '⚛️',
    'node-cli': '💻',
    'node-server': '🌐',
    'static-site': '📄',
    'blank': '📁'
  }

  const isRunnable = ['react-vite', 'node-server', 'node-cli', 'static-site'].includes(app.template)

  const handleRun = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await startApp(app.id)
  }

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await stopApp(app.id)
  }

  return (
    <div
      className={`mb-2 cursor-pointer rounded-lg p-3 transition-colors ${
        isActive
          ? 'border border-blue-500 bg-blue-600/20'
          : 'border border-transparent bg-neutral-800/50 hover:bg-neutral-800'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{templateIcons[app.template]}</span>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{app.name}</h4>
              {/* Running indicator */}
              {status && (
                <span className={`h-2 w-2 rounded-full ${
                  status === 'running' ? 'bg-green-500' :
                  status === 'starting' ? 'animate-pulse bg-yellow-500' :
                  status === 'error' ? 'bg-red-500' : ''
                }`} />
              )}
            </div>
            {app.description && (
              <p className="line-clamp-1 text-sm text-neutral-400">
                {app.description}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {/* Quick run/stop button */}
          {isRunnable && (
            running ? (
              <button
                onClick={handleStop}
                disabled={status === 'starting'}
                className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-red-900/50 hover:text-red-400 disabled:opacity-50"
                title="Stop"
              >
                ⏹
              </button>
            ) : (
              <button
                onClick={handleRun}
                className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-green-900/50 hover:text-green-400"
                title="Run"
              >
                ▶
              </button>
            )
          )}
          
          {/* Delete button - disabled while running */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (!running) onDelete()
            }}
            disabled={running}
            className="rounded p-1 text-neutral-500 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            title={running ? 'Stop app before deleting' : 'Delete app'}
          >
            🗑️
          </button>
        </div>
      </div>
      
      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
        {app.currentBranch && (
          <span className="flex items-center gap-1">
            🌿 {app.currentBranch}
          </span>
        )}
        {app.hasChanges && (
          <span className="text-yellow-500">● Uncommitted</span>
        )}
        {/* Show port when running */}
        {running && url && (
          <span className="text-green-400">
            :{new URL(url).port}
          </span>
        )}
        <span>Updated {formatRelativeTime(app.updatedAt)}</span>
      </div>
    </div>
  )
}
```

---

## Task 3: Update AppHeader

### Update apps/electron/src/renderer/src/components/AppHeader.tsx

First, read the current file to understand its structure, then add controls.

Add imports:

```typescript
import { useRunningApps } from '../context/RunningAppsContext'
```

Update the component to include run controls:

```typescript
import { useCallback } from 'react'
import type { SubApp } from '@anyapp/core'
import { useRunningApps } from '../context/RunningAppsContext'

/**
 * Props for the AppHeader component.
 */
interface AppHeaderProps {
  /** The active app. */
  app: SubApp
  /** Callback to go back to apps list. */
  onBack: () => void
}

/** Templates that can be run. */
const RUNNABLE_TEMPLATES = ['react-vite', 'node-server', 'node-cli', 'static-site']

/**
 * Header showing active app info and controls.
 */
export function AppHeader({ app, onBack }: AppHeaderProps) {
  const { isRunning, getStatus, getUrl, startApp, stopApp, openInBrowser } = useRunningApps()
  
  const running = isRunning(app.id)
  const status = getStatus(app.id)
  const url = getUrl(app.id)
  const isRunnable = RUNNABLE_TEMPLATES.includes(app.template)

  const handleRun = useCallback(async () => {
    await startApp(app.id)
  }, [app.id, startApp])

  const handleStop = useCallback(async () => {
    await stopApp(app.id)
  }, [app.id, stopApp])

  const handleOpenBrowser = useCallback(async () => {
    await openInBrowser(app.id)
  }, [app.id, openInBrowser])

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          title="Back to apps"
        >
          ←
        </button>
        
        <div className="flex items-center gap-2">
          <h1 className="font-semibold">{app.name}</h1>
          
          {/* Status badge */}
          {status && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              status === 'running' ? 'bg-green-900/50 text-green-400' :
              status === 'starting' ? 'bg-yellow-900/50 text-yellow-400' :
              status === 'error' ? 'bg-red-900/50 text-red-400' :
              'bg-neutral-800 text-neutral-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                status === 'running' ? 'bg-green-500' :
                status === 'starting' ? 'animate-pulse bg-yellow-500' :
                status === 'error' ? 'bg-red-500' : 'bg-neutral-500'
              }`} />
              {status === 'running' && url ? `localhost:${new URL(url).port}` : status}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Run/Stop button */}
        {isRunnable && (
          running ? (
            <button
              onClick={handleStop}
              disabled={status === 'starting'}
              className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
            >
              ▶ Run
            </button>
          )
        )}

        {/* Open in browser */}
        {running && url && (
          <button
            onClick={handleOpenBrowser}
            className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-600"
            title="Open in browser"
          >
            🌐 Browser
          </button>
        )}

        {/* Branch info */}
        {app.currentBranch && (
          <span className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-400">
            🌿 {app.currentBranch}
          </span>
        )}
      </div>
    </header>
  )
}
```

---

## Verification Checklist

- [ ] `AppControls.tsx` created in `components/`
- [ ] `AppListing.tsx` updated with running indicators
- [ ] `AppHeader.tsx` updated with run controls
- [ ] `bun run typecheck:all` passes
- [ ] Run/stop buttons work correctly
- [ ] Status indicators update in real-time

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(8.5): add app controls and status indicators

- Create AppControls toolbar component
- Update AppCard with running status dot
- Add quick run/stop buttons to AppCard
- Disable delete while app is running
- Update AppHeader with run controls and status badge
- Show port number when running"
```

---

## Next

Proceed to **SESSION-8.6-LAYOUT-INTEGRATION.md** for the final layout integration.
