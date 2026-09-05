import { useCallback, useState } from 'react'
import { PlayIcon, StopIcon, GlobeIcon, WarningIcon } from '../icons'
import { useRunningApps } from '../../context/RunningAppsContext'
import type { AppTemplate } from '@pitaster/core'

/** Templates that can be started as a dev server. */
const RUNNABLE_TEMPLATES: AppTemplate[] = ['react-vite', 'node-server', 'node-cli', 'static-site']

/** Status dot color per run state. */
const STATUS_DOT: Record<string, string> = {
  running: 'bg-patina',
  starting: 'animate-pulse bg-keylime',
  error: 'bg-rust',
  stopped: 'bg-ash'
}

/** How each run state is named in the status line. */
const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  starting: 'Starting…',
  error: 'Failed to start',
  stopped: 'Stopped'
}

/**
 * Props for the AppServerBlock component.
 */
interface AppServerBlockProps {
  /** The app whose dev server this controls. */
  appId: string
  /** The app's template, which decides whether it can be run at all. */
  template: AppTemplate
}

/**
 * The focused app's dev server: its run state and the controls that change it.
 *
 * This lives in the app's own column rather than the shell header because it
 * acts on the app, not on the agent — and because it sits directly above the
 * Preview toggle, which is where the running server is displayed.
 *
 * The browser button occupies a reserved slot that is hidden rather than
 * unmounted while the server is down, so starting an app does not shift the
 * stop button out from under the pointer that just started it.
 */
export function AppServerBlock({ appId, template }: AppServerBlockProps) {
  const { isRunning, getStatus, getUrl, startApp, stopApp, openInBrowser, installDeps } =
    useRunningApps()

  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const running = isRunning(appId)
  const status = getStatus(appId)
  const url = getUrl(appId)
  const port = running && url ? new URL(url).port : null

  const handleRun = useCallback(async () => {
    setError(null)
    try {
      await startApp(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }, [appId, startApp])

  const handleStop = useCallback(async () => {
    setError(null)
    try {
      await stopApp(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop')
    }
  }, [appId, stopApp])

  const handleOpenBrowser = useCallback(async () => {
    setError(null)
    try {
      await openInBrowser(appId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open browser')
    }
  }, [appId, openInBrowser])

  const handleInstall = useCallback(async () => {
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

  // A template with nothing to serve gets no server block at all.
  if (!RUNNABLE_TEMPLATES.includes(template)) return null

  const canOpenBrowser = running && url !== null

  return (
    <div className="border-t border-line px-2 py-3">
      <p className="eyebrow px-2 pb-2 text-ash">Server</p>

      <div className="flex items-center gap-2 px-2 pb-2 text-[12px]">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status ?? 'stopped'] ?? 'bg-ash'}`}
        />
        <span className={`flex-1 truncate ${status === 'error' ? 'text-rust' : 'text-ash'}`}>
          {STATUS_LABEL[status ?? 'stopped'] ?? 'Stopped'}
        </span>
        {port && <span className="shrink-0 font-mono text-patina">:{port}</span>}
      </div>

      <div className="flex items-center gap-1.5 px-2">
        {running ? (
          <button
            onClick={handleStop}
            disabled={status === 'starting'}
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-rust text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-50"
            title="Stop the dev server"
          >
            <StopIcon size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={status === 'starting'}
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-keylime text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-50"
            title="Start the dev server"
          >
            <PlayIcon size={14} />
            Run
          </button>
        )}

        {/* Always mounted, disabled while there is nothing to open: unmounting
            it would move the run button out from under the pointer that just
            pressed it, and an empty reserved gap would explain nothing. */}
        <button
          onClick={handleOpenBrowser}
          disabled={!canOpenBrowser}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ash transition-colors hover:border-ash hover:text-bone disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ash"
          title={canOpenBrowser ? 'Open in your browser' : 'Run the app to open it in your browser'}
          aria-label="Open in your browser"
        >
          <GlobeIcon size={14} />
        </button>
      </div>

      {!running && (
        <button
          onClick={handleInstall}
          disabled={isInstalling}
          className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-[12px] text-ash transition-colors hover:bg-raised/60 hover:text-bone disabled:opacity-50"
          title="Install this app's dependencies"
        >
          {isInstalling ? 'Installing dependencies…' : 'Install dependencies'}
        </button>
      )}

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 px-2 text-[12px] text-rust">
          <span className="mt-px shrink-0">
            <WarningIcon size={13} />
          </span>
          <span className="min-w-0 flex-1">{error}</span>
        </p>
      )}
    </div>
  )
}
