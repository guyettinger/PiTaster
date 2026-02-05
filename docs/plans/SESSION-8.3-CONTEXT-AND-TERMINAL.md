# Session 8.3: Running Apps Context and Terminal Panel

## Overview

This sub-session creates the React context for tracking running apps and the terminal panel component for displaying dev server logs.

**Estimated scope**: Small  
**Prerequisites**: Session 8.2 complete  
**Deliverable**: RunningAppsContext and TerminalPanel component

## Objectives

1. Create RunningAppsContext for state management
2. Build TerminalPanel component with ANSI color support
3. Add context provider to App.tsx

---

## Task 1: Running Apps Context

### Create apps/electron/src/renderer/src/context/RunningAppsContext.tsx

```typescript
import { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  useCallback,
  type ReactNode 
} from 'react'

/** Running app state. */
interface RunningApp {
  appId: string
  pid: number
  url: string | null
  port: number
  startedAt: string
}

/** App log entry. */
interface AppLogEntry {
  appId: string
  timestamp: string
  type: 'stdout' | 'stderr' | 'system'
  message: string
}

/** App status. */
type AppStatus = 'starting' | 'running' | 'stopped' | 'error'

/** Context value type. */
interface RunningAppsContextType {
  /** Map of running apps by ID. */
  runningApps: Map<string, RunningApp>
  /** Map of app statuses by ID. */
  appStatuses: Map<string, AppStatus>
  /** Map of logs by app ID. */
  logs: Map<string, AppLogEntry[]>
  /** Start an app. */
  startApp: (id: string) => Promise<void>
  /** Stop an app. */
  stopApp: (id: string) => Promise<void>
  /** Check if an app is running. */
  isRunning: (id: string) => boolean
  /** Get app status. */
  getStatus: (id: string) => AppStatus | null
  /** Get URL for an app. */
  getUrl: (id: string) => string | null
  /** Get logs for an app. */
  getLogs: (id: string) => AppLogEntry[]
  /** Clear logs for an app. */
  clearLogs: (id: string) => void
  /** Install dependencies for an app. */
  installDeps: (id: string) => Promise<void>
  /** Open app in browser. */
  openInBrowser: (id: string) => Promise<void>
}

const RunningAppsContext = createContext<RunningAppsContextType | null>(null)

/** Maximum logs to keep per app. */
const MAX_LOGS_PER_APP = 1000

/**
 * Provider component for running apps context.
 */
export function RunningAppsProvider({ children }: { children: ReactNode }) {
  const [runningApps, setRunningApps] = useState<Map<string, RunningApp>>(new Map())
  const [appStatuses, setAppStatuses] = useState<Map<string, AppStatus>>(new Map())
  const [logs, setLogs] = useState<Map<string, AppLogEntry[]>>(new Map())

  // Set up IPC listeners
  useEffect(() => {
    // Load initial running apps
    window.electronAPI.getRunningApps().then(apps => {
      const map = new Map<string, RunningApp>()
      const statuses = new Map<string, AppStatus>()
      for (const app of apps) {
        map.set(app.appId, app)
        statuses.set(app.appId, 'running')
      }
      setRunningApps(map)
      setAppStatuses(statuses)
    })

    // Listen for log events
    window.electronAPI.onAppLog((entry) => {
      setLogs(prev => {
        const newLogs = new Map(prev)
        const appLogs = newLogs.get(entry.appId) ?? []
        const updated = [...appLogs, entry].slice(-MAX_LOGS_PER_APP)
        newLogs.set(entry.appId, updated)
        return newLogs
      })
    })

    // Listen for status changes
    window.electronAPI.onAppStatusChange((change) => {
      setAppStatuses(prev => {
        const newStatuses = new Map(prev)
        newStatuses.set(change.appId, change.status)
        return newStatuses
      })

      if (change.status === 'running' && change.url) {
        setRunningApps(prev => {
          const newApps = new Map(prev)
          const existing = newApps.get(change.appId)
          if (existing) {
            newApps.set(change.appId, { ...existing, url: change.url! })
          }
          return newApps
        })
      }

      if (change.status === 'stopped') {
        setRunningApps(prev => {
          const newApps = new Map(prev)
          newApps.delete(change.appId)
          return newApps
        })
      }
    })

    return () => {
      window.electronAPI.offAppLog()
      window.electronAPI.offAppStatusChange()
    }
  }, [])

  const startApp = useCallback(async (id: string) => {
    setAppStatuses(prev => new Map(prev).set(id, 'starting'))
    try {
      const info = await window.electronAPI.runApp(id)
      setRunningApps(prev => new Map(prev).set(id, info))
    } catch (error) {
      setAppStatuses(prev => new Map(prev).set(id, 'error'))
      throw error
    }
  }, [])

  const stopApp = useCallback(async (id: string) => {
    await window.electronAPI.stopApp(id)
  }, [])

  const isRunning = useCallback((id: string) => {
    const status = appStatuses.get(id)
    return status === 'running' || status === 'starting'
  }, [appStatuses])

  const getStatus = useCallback((id: string) => {
    return appStatuses.get(id) ?? null
  }, [appStatuses])

  const getUrl = useCallback((id: string) => {
    return runningApps.get(id)?.url ?? null
  }, [runningApps])

  const getLogs = useCallback((id: string) => {
    return logs.get(id) ?? []
  }, [logs])

  const clearLogs = useCallback((id: string) => {
    setLogs(prev => {
      const newLogs = new Map(prev)
      newLogs.set(id, [])
      return newLogs
    })
  }, [])

  const installDeps = useCallback(async (id: string) => {
    await window.electronAPI.installDeps(id)
  }, [])

  const openInBrowser = useCallback(async (id: string) => {
    await window.electronAPI.openInBrowser(id)
  }, [])

  const value: RunningAppsContextType = {
    runningApps,
    appStatuses,
    logs,
    startApp,
    stopApp,
    isRunning,
    getStatus,
    getUrl,
    getLogs,
    clearLogs,
    installDeps,
    openInBrowser
  }

  return (
    <RunningAppsContext.Provider value={value}>
      {children}
    </RunningAppsContext.Provider>
  )
}

/**
 * Hook to access running apps context.
 */
export function useRunningApps(): RunningAppsContextType {
  const context = useContext(RunningAppsContext)
  if (!context) {
    throw new Error('useRunningApps must be used within RunningAppsProvider')
  }
  return context
}
```

---

## Task 2: Terminal Panel Component

### Create apps/electron/src/renderer/src/components/TerminalPanel.tsx

```typescript
import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useRunningApps } from '../context/RunningAppsContext'

/** ANSI color code mappings. */
const ANSI_COLORS: Record<string, string> = {
  '30': 'text-neutral-900',
  '31': 'text-red-500',
  '32': 'text-green-500',
  '33': 'text-yellow-500',
  '34': 'text-blue-500',
  '35': 'text-purple-500',
  '36': 'text-cyan-500',
  '37': 'text-neutral-200',
  '90': 'text-neutral-500',
  '91': 'text-red-400',
  '92': 'text-green-400',
  '93': 'text-yellow-400',
  '94': 'text-blue-400',
  '95': 'text-purple-400',
  '96': 'text-cyan-400',
  '97': 'text-white',
}

/**
 * Parse ANSI codes and return styled spans.
 */
function parseAnsi(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /\x1b\[(\d+)m/g
  let lastIndex = 0
  let currentClass = ''
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before this code
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      parts.push(
        <span key={lastIndex} className={currentClass}>
          {segment}
        </span>
      )
    }

    // Update color class
    const code = match[1]
    if (code === '0' || code === '39') {
      currentClass = ''
    } else if (ANSI_COLORS[code]) {
      currentClass = ANSI_COLORS[code]
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={lastIndex} className={currentClass}>
        {text.slice(lastIndex)}
      </span>
    )
  }

  return parts.length > 0 ? parts : [text]
}

/**
 * Props for the TerminalPanel component.
 */
interface TerminalPanelProps {
  /** App ID to show logs for. */
  appId: string
  /** Whether the panel is visible. */
  isVisible: boolean
}

/**
 * Terminal panel for displaying app logs.
 */
export function TerminalPanel({ appId, isVisible }: TerminalPanelProps) {
  const { getLogs, clearLogs, getStatus } = useRunningApps()
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [filter, setFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all')

  const logs = getLogs(appId)
  const status = getStatus(appId)

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs
    return logs.filter(log => log.type === filter)
  }, [logs, filter])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll])

  // Handle scroll to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }, [])

  const formatTimestamp = useCallback((iso: string) => {
    return new Date(iso).toLocaleTimeString()
  }, [])

  if (!isVisible) return null

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Terminal</span>
          {status && (
            <span className={`text-xs ${
              status === 'running' ? 'text-green-500' : 
              status === 'starting' ? 'text-yellow-500' :
              status === 'error' ? 'text-red-500' : 'text-neutral-500'
            }`}>
              {status}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
          >
            <option value="all">All</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
            <option value="system">system</option>
          </select>

          {/* Timestamps toggle */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={`rounded px-2 py-1 text-xs ${
              showTimestamps ? 'bg-neutral-700' : 'hover:bg-neutral-800'
            }`}
            title="Toggle timestamps"
          >
            🕐
          </button>

          {/* Auto-scroll indicator */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded px-2 py-1 text-xs ${
              autoScroll ? 'bg-neutral-700' : 'hover:bg-neutral-800'
            }`}
            title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
          >
            ⬇️
          </button>

          {/* Clear */}
          <button
            onClick={() => clearLogs(appId)}
            className="rounded px-2 py-1 text-xs hover:bg-neutral-800"
            title="Clear logs"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-neutral-500">
            {status === 'starting' ? 'Starting...' : 'No logs yet. Run the app to see output.'}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={`${log.timestamp}-${index}`}
              className={`whitespace-pre-wrap ${
                log.type === 'stderr' ? 'text-red-400' :
                log.type === 'system' ? 'text-blue-400' : ''
              }`}
            >
              {showTimestamps && (
                <span className="mr-2 text-neutral-600">
                  [{formatTimestamp(log.timestamp)}]
                </span>
              )}
              {log.type === 'system' && (
                <span className="mr-1 text-blue-500">[system]</span>
              )}
              {parseAnsi(log.message)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

---

## Task 3: Add Context Provider to App

### Update apps/electron/src/renderer/src/App.tsx

Add import at top:

```typescript
import { RunningAppsProvider } from './context/RunningAppsContext'
```

Wrap the entire app content with the provider. Update the return statement:

```typescript
  return (
    <RunningAppsProvider>
      <div className="flex h-screen bg-neutral-950 text-neutral-50">
        {/* ... existing content ... */}
      </div>
    </RunningAppsProvider>
  )
```

---

## Verification Checklist

- [ ] `RunningAppsContext.tsx` created in `context/` directory
- [ ] `TerminalPanel.tsx` created in `components/` directory
- [ ] `App.tsx` wrapped with `RunningAppsProvider`
- [ ] `bun run typecheck:all` passes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(8.3): add running apps context and terminal panel

- Create RunningAppsContext for state management
- Track running apps, statuses, and logs per app
- Build TerminalPanel with ANSI color support
- Add log filtering and timestamp display
- Add auto-scroll with manual override"
```

---

## Next

Proceed to **SESSION-8.4-PREVIEW-PANEL.md** to add the embedded preview component.
