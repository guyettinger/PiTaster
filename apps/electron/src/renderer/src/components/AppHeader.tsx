import { useCallback } from 'react'
import type { SubApp, AppTemplate } from '@anyapp/core'
import { useRunningApps } from '../context/RunningAppsContext'

/**
 * Props for the AppHeader component.
 */
interface AppHeaderProps {
  /** The currently active app. */
  app: SubApp | null
  /** Callback when back button is clicked. */
  onBack: () => void
}

const TEMPLATE_LABELS: Record<AppTemplate, string> = {
  'react-vite': 'React + Vite',
  'node-cli': 'Node CLI',
  'node-server': 'Node Server',
  'static-site': 'Static Site',
  'blank': 'Blank Project'
}

/** Templates that can be run. */
const RUNNABLE_TEMPLATES = ['react-vite', 'node-server', 'node-cli', 'static-site']

/**
 * Header component showing active app context.
 */
export function AppHeader({ app, onBack }: AppHeaderProps) {
  const { isRunning, getStatus, getUrl, startApp, stopApp, openInBrowser } = useRunningApps()
  
  const running = app ? isRunning(app.id) : false
  const status = app ? getStatus(app.id) : null
  const url = app ? getUrl(app.id) : null
  const isRunnable = app ? RUNNABLE_TEMPLATES.includes(app.template) : false

  const handleRun = useCallback(async () => {
    if (app) await startApp(app.id)
  }, [app, startApp])

  const handleStop = useCallback(async () => {
    if (app) await stopApp(app.id)
  }, [app, stopApp])

  const handleOpenBrowser = useCallback(async () => {
    if (app) await openInBrowser(app.id)
  }, [app, openInBrowser])

  if (!app) return null

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/50 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          title="Back to app list"
        >
          ←
        </button>
        
        <div className="flex items-center gap-2">
          <h2 className="font-medium">{app.name}</h2>
          
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
