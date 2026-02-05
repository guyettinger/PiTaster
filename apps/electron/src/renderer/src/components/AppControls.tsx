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
