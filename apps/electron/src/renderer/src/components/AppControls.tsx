import { useCallback, useState } from 'react'
import { PlayIcon, StopIcon, GlobeIcon, WarningIcon } from './icons'
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
  /** Whether to show text labels beside the icons. */
  showLabels?: boolean
  /** Size variant. */
  size?: 'sm' | 'md'
}

/**
 * Run, stop, install, and open-in-browser for one app.
 *
 * Actions only — run state is reported by the shell header's status pill and by
 * the app cards, so this does not draw a status dot of its own.
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

  const buttonClass =
    size === 'sm'
      ? 'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]'
      : 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]'
  const iconSize = size === 'sm' ? 13 : 15

  return (
    <div className="flex items-center gap-1.5">
      {isRunnable &&
        (running ? (
          <button
            onClick={handleStop}
            disabled={status === 'starting'}
            className={`${buttonClass} bg-rust font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-50`}
            title="Stop the dev server"
          >
            <StopIcon size={iconSize} />
            {showLabels && 'Stop'}
          </button>
        ) : (
          <button
            onClick={handleRun}
            className={`${buttonClass} bg-brass font-medium text-ground transition-opacity hover:opacity-90`}
            title="Start the dev server"
          >
            <PlayIcon size={iconSize} />
            {showLabels && 'Run'}
          </button>
        ))}

      {running && url && (
        <button
          onClick={handleOpenBrowser}
          className={`${buttonClass} border border-line text-bone transition-colors hover:border-ash`}
          title="Open in your browser"
        >
          <GlobeIcon size={iconSize} />
          {showLabels && 'Browser'}
        </button>
      )}

      {isRunnable && !running && (
        <button
          onClick={handleInstall}
          disabled={isInstalling}
          className={`${buttonClass} border border-line text-ash transition-colors hover:border-ash hover:text-bone disabled:opacity-50`}
          title="Install this app's dependencies"
        >
          {isInstalling ? 'Installing…' : 'Install'}
        </button>
      )}

      {error && (
        <span className="flex items-center text-rust" title={error}>
          <WarningIcon size={iconSize} />
        </span>
      )}
    </div>
  )
}
