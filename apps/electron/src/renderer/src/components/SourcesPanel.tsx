import { useState, useEffect, useCallback } from 'react'

import { AddSourceForm, generateId, parseEnvLines } from './AddSourceForm'
import type { McpSourceFormData } from './AddSourceForm'

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
  command?: string
  args?: string[]
  env?: Record<string, string>
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
 * Convert an env record back to KEY=VALUE lines for form editing.
 * @param env - Record of environment variables
 * @returns Newline-separated KEY=VALUE string
 */
function envRecordToLines(env?: Record<string, string>): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/**
 * Sources panel component for managing external source connections.
 */
export function SourcesPanel({ isVisible }: SourcesPanelProps) {
  const [sources, setSources] = useState<ConnectedSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingSource, setEditingSource] = useState<SourceConfig | null>(null)

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

  /**
   * Handle saving a new source from the add form.
   */
  const handleAddSource = useCallback(
    async (formData: McpSourceFormData) => {
      try {
        setIsSaving(true)
        setError(null)

        let id = generateId(formData.name)

        // Check for ID collision against loaded configs
        const existingConfigs = await window.electronAPI.loadSourceConfigs()
        const existingIds = new Set(existingConfigs.map((c) => c.id))

        if (existingIds.has(id)) {
          let suffix = 2
          while (existingIds.has(`${id}-${suffix}`)) suffix++
          id = `${id}-${suffix}`
        }

        const config = {
          id,
          name: formData.name.trim(),
          type: 'mcp' as const,
          enabled: true,
          createdAt: new Date().toISOString(),
          command: formData.command.trim(),
          args: formData.args
            .trim()
            .split(/\s+/)
            .filter(Boolean),
          env: parseEnvLines(formData.env)
        }

        await window.electronAPI.saveSource(config)
        setIsAdding(false)

        // Refresh list, then auto-connect
        await loadSources()
        try {
          await window.electronAPI.connectSource(config.id)
        } catch {
          // Auto-connect may fail (e.g., bad command) — non-fatal
        }
        await loadSources()
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to save source'
        setError(errorMessage)
      } finally {
        setIsSaving(false)
      }
    },
    [loadSources]
  )

  /**
   * Handle saving an edited source.
   */
  const handleEditSource = useCallback(
    async (formData: McpSourceFormData) => {
      if (!editingSource) return
      try {
        setIsSaving(true)
        setError(null)

        // Disconnect if currently connected
        const existing = sources.find(
          (s) => s.config.id === editingSource.id
        )
        if (existing?.connected) {
          await window.electronAPI.disconnectSource(editingSource.id)
        }

        const updatedConfig = {
          ...editingSource,
          name: formData.name.trim(),
          command: formData.command.trim(),
          args: formData.args
            .trim()
            .split(/\s+/)
            .filter(Boolean),
          env: parseEnvLines(formData.env)
        }

        await window.electronAPI.saveSource(updatedConfig)
        setEditingSource(null)
        await loadSources()
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to save source'
        setError(errorMessage)
      } finally {
        setIsSaving(false)
      }
    },
    [editingSource, sources, loadSources]
  )

  /**
   * Handle deleting a source (called on second click to confirm).
   */
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        setDeletingId(id)
        setError(null)
        await window.electronAPI.deleteSource(id)
        await loadSources()
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete source'
        setError(errorMessage)
      } finally {
        setDeletingId(null)
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setIsAdding(!isAdding)
              setEditingSource(null)
            }}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Add source"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
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
      </div>

      {/* Add Source Form */}
      {isAdding && !editingSource && (
        <AddSourceForm
          onSave={handleAddSource}
          onCancel={() => setIsAdding(false)}
          isSaving={isSaving}
        />
      )}

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
      ) : sources.length === 0 && !isAdding ? (
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
          <button
            onClick={() => setIsAdding(true)}
            className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            + Add MCP Source
          </button>
          <p className="mt-2 text-xs text-neutral-600">
            Connect MCP servers to extend agent capabilities
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sources.map((source) => (
            <div key={source.config.id}>
              {/* Edit form for this source (replaces the card content) */}
              {editingSource?.id === source.config.id ? (
                <AddSourceForm
                  onSave={handleEditSource}
                  onCancel={() => setEditingSource(null)}
                  isSaving={isSaving}
                  initialData={{
                    name: source.config.name,
                    command: source.config.command ?? '',
                    args: source.config.args?.join(' ') ?? '',
                    env: envRecordToLines(source.config.env)
                  }}
                />
              ) : (
                <div className="border-b border-neutral-800 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            source.connected
                              ? 'bg-green-500'
                              : 'bg-neutral-600'
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
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() =>
                          source.connected
                            ? handleDisconnect(source.config.id)
                            : handleConnect(source.config.id)
                        }
                        disabled={connectingId === source.config.id}
                        className="rounded px-2 py-1 text-xs text-blue-400 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {connectingId === source.config.id
                          ? 'Working...'
                          : source.connected
                            ? 'Disconnect'
                            : 'Connect'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingSource(source.config)
                          setIsAdding(false)
                        }}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                        title="Edit source"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (deletingId === source.config.id) {
                            handleDelete(source.config.id)
                          } else {
                            setDeletingId(source.config.id)
                            // Reset after 3 seconds if not confirmed
                            setTimeout(() => setDeletingId((prev) =>
                              prev === source.config.id ? null : prev
                            ), 3000)
                          }
                        }}
                        className="rounded px-2 py-1 text-xs text-red-400 hover:bg-neutral-800"
                        title="Delete source"
                      >
                        {deletingId === source.config.id
                          ? 'Confirm?'
                          : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {source.error && (
                    <p className="mt-2 text-xs text-red-400">{source.error}</p>
                  )}

                  {source.connected &&
                    source.tools &&
                    source.tools.length > 0 && (
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
