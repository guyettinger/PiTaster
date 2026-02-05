import { useRef, useState, useCallback, useEffect } from 'react'
import { useRunningApps } from '../context/RunningAppsContext'

/**
 * Props for the PreviewPanel component.
 */
interface PreviewPanelProps {
  /** App ID to preview. */
  appId: string
  /** Whether the panel is visible. */
  isVisible: boolean
}

/**
 * Preview panel with embedded webview for running apps.
 */
export function PreviewPanel({ appId, isVisible }: PreviewPanelProps) {
  const { getUrl, getStatus, isRunning, openInBrowser } = useRunningApps()
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const url = getUrl(appId)
  const status = getStatus(appId)
  const running = isRunning(appId)

  // Update URL when app starts
  useEffect(() => {
    if (url) {
      setCurrentUrl(url)
      setError(null)
    }
  }, [url])

  // Set up webview event listeners
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleLoadStart = () => setIsLoading(true)
    const handleLoadStop = () => setIsLoading(false)
    const handleLoadFail = (e: Electron.DidFailLoadEvent) => {
      // Ignore aborted loads (happens during refresh)
      if (e.errorCode === -3) return
      setError(`Failed to load: ${e.errorDescription}`)
      setIsLoading(false)
    }
    const handleNavigate = (e: Electron.DidNavigateEvent) => {
      setCurrentUrl(e.url)
    }

    webview.addEventListener('did-start-loading', handleLoadStart)
    webview.addEventListener('did-stop-loading', handleLoadStop)
    webview.addEventListener('did-fail-load', handleLoadFail as unknown as EventListener)
    webview.addEventListener('did-navigate', handleNavigate as unknown as EventListener)

    return () => {
      webview.removeEventListener('did-start-loading', handleLoadStart)
      webview.removeEventListener('did-stop-loading', handleLoadStop)
      webview.removeEventListener('did-fail-load', handleLoadFail as unknown as EventListener)
      webview.removeEventListener('did-navigate', handleNavigate as unknown as EventListener)
    }
  }, [])

  const handleRefresh = useCallback(() => {
    webviewRef.current?.reload()
  }, [])

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack()
  }, [])

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward()
  }, [])

  const handleOpenExternal = useCallback(async () => {
    await openInBrowser(appId)
  }, [appId, openInBrowser])

  const handleOpenDevTools = useCallback(() => {
    webviewRef.current?.openDevTools()
  }, [])

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (currentUrl && webviewRef.current) {
      webviewRef.current.loadURL(currentUrl)
    }
  }, [currentUrl])

  if (!isVisible) return null

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleBack}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            title="Back"
          >
            ←
          </button>
          <button
            onClick={handleForward}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            title="Forward"
          >
            →
          </button>
          <button
            onClick={handleRefresh}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1">
          <input
            type="text"
            value={currentUrl}
            onChange={(e) => setCurrentUrl(e.target.value)}
            placeholder={running ? 'Enter URL' : 'App not running'}
            disabled={!running}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
        </form>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenExternal}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            title="Open in browser"
          >
            ↗
          </button>
          <button
            onClick={handleOpenDevTools}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            title="Open DevTools"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1">
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-x-0 top-0 h-1 bg-blue-500/30">
            <div className="h-full w-1/3 animate-pulse bg-blue-500" />
          </div>
        )}

        {/* Not running state */}
        {!running && (
          <div className="flex h-full flex-col items-center justify-center text-neutral-500">
            <div className="mb-3 text-4xl">🖥️</div>
            <h3 className="mb-1 font-medium">App not running</h3>
            <p className="text-sm">
              {status === 'starting' 
                ? 'Starting...' 
                : 'Run the app to see the preview'}
            </p>
          </div>
        )}

        {/* Error state */}
        {error && running && (
          <div className="flex h-full flex-col items-center justify-center text-neutral-500">
            <div className="mb-3 text-4xl">⚠️</div>
            <h3 className="mb-1 font-medium text-red-400">Load Error</h3>
            <p className="mb-3 text-sm">{error}</p>
            <button
              onClick={handleRefresh}
              className="rounded bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Webview */}
        {running && url && !error && (
          <webview
            ref={webviewRef as React.RefObject<HTMLElement>}
            src={url}
            className="h-full w-full"
            partition="persist:preview"
            allowpopups
          />
        )}
      </div>
    </div>
  )
}
