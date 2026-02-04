import { useState, useEffect, useCallback } from 'react'

/**
 * MCP tool definition.
 */
interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * Source configuration.
 */
interface SourceConfig {
  id: string
  name: string
  type: 'mcp' | 'api' | 'filesystem'
  enabled: boolean
  createdAt: string
}

/**
 * Connected source state.
 */
interface ConnectedSource {
  config: SourceConfig
  connected: boolean
  tools?: McpTool[]
  error?: string
}

/**
 * Props for the SourcesPanel component.
 */
interface SourcesPanelProps {
  /** Whether the panel is visible. */
  isVisible: boolean
}

/**
 * Sources panel component for managing external source connections.
 */
export function SourcesPanel({ isVisible }: SourcesPanelProps) {
  const [sources, setSources] = useState<ConnectedSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const loadSources = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Load configs and connected sources
      const [configs, connectedSources] = await Promise.all([
        window.electronAPI.loadSourceConfigs(),
        window.electronAPI.getSources()
      ])

      // Merge configs with connected state
      const connectedMap = new Map(
        connectedSources.map((s) => [s.config.id, s])
      )

      const merged: ConnectedSource[] = configs.map((config) => {
        const connected = connectedMap.get(config.id)
        if (connected) {
          return connected
        }
        return {
          config,
          connected: false
        }
      })

      setSources(merged)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load sources'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isVisible) {
      loadSources()
    }
  }, [isVisible, loadSources])

  const handleConnect = useCallback(
    async (id: string) => {
      try {
        setConnectingId(id)
        await window.electronAPI.connectSource(id)
        await loadSources()
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to connect'
        setError(errorMessage)
      } finally {
        setConnectingId(null)
      }
    },
    [loadSources]
  )

  const handleDisconnect = useCallback(
    async (id: string) => {
      try {
        setConnectingId(id)
        await window.electronAPI.disconnectSource(id)
        await loadSources()
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to disconnect'
        setError(errorMessage)
      } finally {
        setConnectingId(null)
      }
    },
    [loadSources]
  )

  if (!isVisible) return null

  return (
    <div className="flex w-72 flex-col border-l border-neutral-800 bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Sources</h2>
        <button
          onClick={loadSources}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          title="Refresh"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-neutral-500">Loading...</span>
        </div>
      ) : error ? (
        <div className="p-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={loadSources}
            className="mt-2 text-sm text-blue-400 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : sources.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <svg
            className="mb-2 h-8 w-8 text-neutral-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
            />
          </svg>
          <p className="text-sm text-neutral-500">No sources configured</p>
          <p className="mt-1 text-xs text-neutral-600">
            Add MCP servers in ~/.anyapp/sources/
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sources.map((source) => (
            <div
              key={source.config.id}
              className="border-b border-neutral-800 p-3"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        source.connected ? 'bg-green-500' : 'bg-neutral-600'
                      }`}
                    />
                    <span className="truncate text-sm font-medium text-neutral-200">
                      {source.config.name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {source.config.type}
                  </p>
                </div>
                <button
                  onClick={() =>
                    source.connected
                      ? handleDisconnect(source.config.id)
                      : handleConnect(source.config.id)
                  }
                  disabled={connectingId === source.config.id}
                  className="shrink-0 rounded px-2 py-1 text-xs text-blue-400 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {connectingId === source.config.id
                    ? 'Working...'
                    : source.connected
                      ? 'Disconnect'
                      : 'Connect'}
                </button>
              </div>

              {source.error && (
                <p className="mt-2 text-xs text-red-400">{source.error}</p>
              )}

              {source.connected && source.tools && source.tools.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-neutral-500">
                    {source.tools.length} tool
                    {source.tools.length !== 1 ? 's' : ''} available
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {source.tools.slice(0, 5).map((tool) => (
                      <span
                        key={tool.name}
                        className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400"
                        title={tool.description}
                      >
                        {tool.name}
                      </span>
                    ))}
                    {source.tools.length > 5 && (
                      <span className="px-1.5 py-0.5 text-xs text-neutral-500">
                        +{source.tools.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
