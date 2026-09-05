import { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  useCallback,
  useMemo,
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
    const unsubscribeLog = window.electronAPI.onAppLog((entry) => {
      setLogs(prev => {
        const newLogs = new Map(prev)
        const appLogs = newLogs.get(entry.appId) ?? []
        const updated = [...appLogs, entry].slice(-MAX_LOGS_PER_APP)
        newLogs.set(entry.appId, updated)
        return newLogs
      })
    })

    // Listen for status changes
    const unsubscribeStatus = window.electronAPI.onAppStatusChange((change) => {
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
      unsubscribeLog()
      unsubscribeStatus()
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

  // Memoized because every dock panel consumes this: an object rebuilt on each
  // render would re-render all of them, transcript and webview host included,
  // on every log line the dev server emits.
  const value = useMemo<RunningAppsContextType>(
    () => ({
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
    }),
    [
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
    ]
  )

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
