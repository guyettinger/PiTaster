import { useState, useEffect, useCallback } from 'react'

import { AddSourceForm, generateId, parseEnvLines } from './AddSourceForm'
import { SourceIcon, PlusIcon, RefreshIcon } from './icons'
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
  isVisible?: boolean
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
export function SourcesPanel({ isVisible = true }: SourcesPanelProps) {
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
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-bone">Sources</h2>
          <p className="text-[12px] text-ash">
            MCP servers whose tools the agent can call. They always ask before running,
            except in Auto — all.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={loadSources}
            className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
            title="Reload sources"
          >
            <RefreshIcon size={16} />
          </button>
          <button
            onClick={() => {
              setIsAdding(!isAdding)
              setEditingSource(null)
            }}
            className="flex items-center gap-1 rounded-lg bg-brass px-3 py-1.5 text-[12.5px] font-medium text-ground transition-opacity hover:opacity-90"
          >
            <PlusIcon size={14} />
            Add source
          </button>
        </div>
      </div>

      {isAdding && !editingSource && (
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">
          <AddSourceForm
            onSave={handleAddSource}
            onCancel={() => setIsAdding(false)}
            isSaving={isSaving}
          />
        </div>
      )}

      {isLoading ? (
        <p className="mt-6 text-[13px] text-ash">Loading sources…</p>
      ) : error ? (
        <div className="mt-3 rounded-lg border border-rust/40 bg-rust/10 p-3">
          <p className="text-[13px] text-bone">{error}</p>
          <button
            onClick={loadSources}
            className="mt-2 text-[13px] text-brass hover:underline"
          >
            Try again
          </button>
        </div>
      ) : sources.length === 0 && !isAdding ? (
        <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <span className="text-ash">
            <SourceIcon size={26} />
          </span>
          <p className="mt-3 text-[13px] text-bone">No sources connected</p>
          <p className="mt-1 max-w-xs text-[12px] text-ash">
            Connect an MCP server to give the agent tools beyond reading and writing files.
          </p>
          <button
            onClick={() => setIsAdding(true)}
            className="mt-4 rounded-lg bg-brass px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
          >
            Add source
          </button>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {sources.map((source) => (
            <li
              key={source.config.id}
              className="overflow-hidden rounded-lg border border-line bg-panel"
            >
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
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            source.connected ? 'bg-patina' : 'bg-line'
                          }`}
                        />
                        <span className="truncate text-[13.5px] font-medium text-bone">
                          {source.config.name}
                        </span>
                        <span className="eyebrow text-ash">{source.config.type}</span>
                      </div>
                      {source.config.command && (
                        <p className="mt-1 truncate font-mono text-[11.5px] text-ash">
                          {source.config.command}
                          {source.config.args?.length ? ` ${source.config.args.join(' ')}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() =>
                          source.connected
                            ? handleDisconnect(source.config.id)
                            : handleConnect(source.config.id)
                        }
                        disabled={connectingId === source.config.id}
                        className="rounded border border-line px-2 py-1 text-[12px] text-bone transition-colors hover:border-ash disabled:opacity-50"
                      >
                        {connectingId === source.config.id
                          ? 'Working…'
                          : source.connected
                            ? 'Disconnect'
                            : 'Connect'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingSource(source.config)
                          setIsAdding(false)
                        }}
                        className="rounded px-2 py-1 text-[12px] text-ash transition-colors hover:bg-raised hover:text-bone"
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
                            setTimeout(
                              () =>
                                setDeletingId((prev) =>
                                  prev === source.config.id ? null : prev
                                ),
                              3000
                            )
                          }
                        }}
                        className="rounded px-2 py-1 text-[12px] text-ash transition-colors hover:bg-raised hover:text-rust"
                      >
                        {deletingId === source.config.id ? 'Confirm' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {source.error && (
                    <p className="mt-2 rounded bg-rust/10 px-2 py-1.5 text-[12px] text-bone">
                      {source.error}
                    </p>
                  )}

                  {source.connected && source.tools && source.tools.length > 0 && (
                    <div className="mt-3">
                      <p className="eyebrow text-ash">
                        {source.tools.length} tool{source.tools.length !== 1 ? 's' : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {source.tools.slice(0, 8).map((tool) => (
                          <span
                            key={tool.name}
                            className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ash"
                            title={tool.description}
                          >
                            {tool.name}
                          </span>
                        ))}
                        {source.tools.length > 8 && (
                          <span className="px-1 py-0.5 text-[11px] text-ash">
                            +{source.tools.length - 8} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
