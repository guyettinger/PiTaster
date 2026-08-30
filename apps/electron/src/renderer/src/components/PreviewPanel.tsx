import { useRef, useState, useCallback, useEffect } from 'react'
import { ArrowLeftIcon, RefreshIcon, GlobeIcon, SearchIcon, CheckIcon, WarningIcon } from './icons'
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
  const [isInspecting, setIsInspecting] = useState(false)

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

  /**
   * Toggle inspector mode in the webview.
   */
  const toggleInspector = useCallback(async () => {
    if (!webviewRef.current) return

    try {
      if (isInspecting) {
        // Deactivate
        await webviewRef.current.executeJavaScript('window.__anyappInspector?.deactivate()')
        setIsInspecting(false)
      } else {
        // Load inspector script if not already loaded
        const hasInspector = await webviewRef.current.executeJavaScript(
          'typeof window.__anyappInspector !== "undefined"'
        )

        if (!hasInspector) {
          // Read and inject the overlay script
          const overlayScript = await window.electronAPI.getInspectorScript()
          await webviewRef.current.executeJavaScript(overlayScript)
        }

        // Activate
        await webviewRef.current.executeJavaScript('window.__anyappInspector?.activate()')
        setIsInspecting(true)
      }
    } catch (err) {
      console.error('Failed to toggle inspector:', err)
    }
  }, [isInspecting])

  /**
   * Keyboard shortcuts for inspector.
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC exits inspect mode
      if (e.key === 'Escape' && isInspecting) {
        toggleInspector()
      }

      // Cmd/Ctrl+Shift+I toggles inspect mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
        e.preventDefault()
        toggleInspector()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isInspecting, toggleInspector])

  /**
   * Handle element selection messages from webview.
   */
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'anyapp:element-selected') {
        const elementInfo = event.data.data

        try {
          // Capture screenshot
          const elementContext = await window.electronAPI.captureElement(elementInfo)

          // Inject into chat
          await window.electronAPI.addElementContext(elementContext)

          // Exit inspect mode
          setIsInspecting(false)
          if (webviewRef.current) {
            await webviewRef.current.executeJavaScript('window.__anyappInspector?.deactivate()')
          }
        } catch (err) {
          console.error('Failed to capture element:', err)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  /**
   * ESC key exits inspect mode.
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isInspecting) {
        toggleInspector()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isInspecting, toggleInspector])

  if (!isVisible) return null

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleBack}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-raised disabled:opacity-50"
            title="Back"
          >
            <ArrowLeftIcon size={15} />
          </button>
          <button
            onClick={handleForward}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-raised disabled:opacity-50"
            title="Forward"
          >
            <ArrowLeftIcon size={15} className="rotate-180" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-raised disabled:opacity-50"
            title="Reload"
          >
            <RefreshIcon size={15} />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1">
          <input
            type="text"
            value={currentUrl}
            onChange={(e) => setCurrentUrl(e.target.value)}
            placeholder={running ? 'Address' : 'Run the app to preview it'}
            disabled={!running}
            className="w-full rounded border border-line bg-raised px-3 py-1.5 text-sm transition-colors hover:border-ash disabled:opacity-50"
          />
        </form>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Inspect button */}
          <button
            onClick={toggleInspector}
            disabled={!running}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors disabled:opacity-50 ${
              isInspecting
                ? 'bg-brass font-medium text-ground'
                : 'border border-line text-bone hover:border-ash'
            }`}
            title={
              isInspecting
                ? 'Stop inspecting (Esc)'
                : 'Click an element to add it to the chat (⌘⇧I)'
            }
          >
            {isInspecting ? (
              <>
                <CheckIcon size={13} />
                Inspecting
              </>
            ) : (
              <>
                <SearchIcon size={13} />
                Inspect
              </>
            )}
          </button>
          <button
            onClick={handleOpenExternal}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-raised disabled:opacity-50"
            title="Open in your browser"
          >
            <GlobeIcon size={15} />
          </button>
          <button
            onClick={handleOpenDevTools}
            disabled={!running}
            className="rounded p-1.5 text-sm hover:bg-raised disabled:opacity-50"
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
          <div className="absolute inset-x-0 top-0 h-1 bg-brass/10">
            <div className="h-full w-1/3 animate-pulse bg-brass" />
          </div>
        )}

        {/* Not running state */}
        {!running && (
          <div className="flex h-full flex-col items-center justify-center text-ash">
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
          <div className="flex h-full flex-col items-center justify-center text-ash">
            <span className="mb-3 text-rust">
              <WarningIcon size={28} />
            </span>
            <h3 className="mb-1 font-medium text-rust">Load Error</h3>
            <p className="mb-3 text-sm">{error}</p>
            <button
              onClick={handleRefresh}
              className="rounded bg-raised px-4 py-2 text-sm hover:bg-line"
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
