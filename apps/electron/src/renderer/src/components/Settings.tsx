/**
 * Settings: everything that configures the workspace rather than one app.
 */

import { useState, useEffect, useCallback } from 'react'
import { SourcesPanel } from './SourcesPanel'
import { PermissionModeControl, describePermissionMode } from './PermissionModeControl'
import { WarningIcon, CheckIcon } from './icons'
import type { PermissionMode } from '../types/electron'

/**
 * Application configuration.
 */
export interface AppConfig {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  ollamaBaseUrl: string
  /** Selected model tag, for example `qwen3-coder:30b`, or null when none is chosen. */
  ollamaModel: string | null
  /** UI theme preference. */
  theme: 'light' | 'dark' | 'system'
  /** Whether to auto-commit file changes. */
  autoCommit: boolean
}

/**
 * A model pulled into the local Ollama instance.
 */
export interface OllamaModel {
  /** Model tag as Ollama reports it. */
  id: string
  /** Parameter size string reported by Ollama, for example `30.5B`. */
  parameterSize?: string
  /** Context window in tokens. */
  contextWindow: number
  /** Whether the model supports function calling. The agent's tools require it. */
  supportsTools: boolean
}

/** The sections of Settings. */
type SettingsTab = 'general' | 'sources' | 'about'

/** Tab order and labels. */
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sources', label: 'Sources' },
  { id: 'about', label: 'About' }
]

/** Default configuration used before the persisted one loads. */
const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: null,
  theme: 'dark',
  autoCommit: true
}

/** Shared input styling, so every field in Settings matches. */
const FIELD_CLASS =
  'w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-bone placeholder-ash transition-colors hover:border-ash'

/**
 * Props for the Field component.
 */
interface FieldProps {
  /** The control's label. */
  label: string
  /** One line on what the setting does, shown under the control. */
  hint?: string
  /** The control itself. */
  children: React.ReactNode
}

/**
 * One labelled setting.
 */
function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="mt-5 max-w-xl">
      <label className="block text-[12.5px] font-medium text-bone">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[12px] text-ash">{hint}</p>}
    </div>
  )
}

/**
 * Props for the Settings component.
 */
interface SettingsProps {
  /** The agent's permission mode. */
  permissionMode: PermissionMode
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
}

/**
 * Settings for the workspace: the local model the agent runs on, whether its
 * writes are committed automatically, and which MCP sources it can reach.
 *
 * Sources live here rather than in the nav rail because they are workspace-wide
 * configuration stored under `~/.anyapp/sources`, not something scoped to the
 * app you happen to have open.
 */
export function Settings({ permissionMode, onModeChange }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [reachable, setReachable] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshModels = useCallback(async (baseUrl: string) => {
    setRefreshing(true)
    try {
      const connected = await window.electronAPI.checkModelConnection(baseUrl)
      setReachable(connected)
      setModels(connected ? await window.electronAPI.listModels() : [])
    } catch (err) {
      setReachable(false)
      setModels([])
      console.error('Failed to list Ollama models:', err)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const loaded = await window.electronAPI.getConfig()
      setConfig(loaded)
      await refreshModels(loaded.ollamaBaseUrl)
    } catch (err) {
      setError('Settings could not be loaded.')
      console.error('Failed to load config:', err)
    } finally {
      setLoading(false)
    }
  }, [refreshModels])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const saveConfig = useCallback(async () => {
    try {
      setError(null)
      await window.electronAPI.saveConfig(config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await refreshModels(config.ollamaBaseUrl)
    } catch (err) {
      setError('Settings could not be saved.')
      console.error('Failed to save config:', err)
    }
  }, [config, refreshModels])

  const selectedLacksTools = models.some(
    (model) => model.id === config.ollamaModel && !model.supportsTools
  )

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 pt-4">
        <h1 className="text-[15px] font-semibold text-bone">Settings</h1>
        {/* -ml-3 cancels the first tab's own px-3, so its label starts on the
            page gutter rather than 12px inside it. */}
        <nav className="-ml-3 mt-3 flex gap-1" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
              className={`relative rounded-t px-3 py-1.5 text-[13px] transition-colors ${
                tab === entry.id
                  ? 'text-bone'
                  : 'text-ash hover:bg-raised/60 hover:text-bone'
              }`}
            >
              {entry.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-brass transition-opacity ${
                  tab === entry.id ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="pb-8">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rust/40 bg-rust/10 p-3">
              <span className="mt-0.5 shrink-0 text-rust">
                <WarningIcon size={16} />
              </span>
              <p className="text-[13px] text-bone">{error}</p>
            </div>
          )}

          {tab === 'general' &&
            (loading ? (
              <p className="text-[13px] text-ash">Loading settings…</p>
            ) : (
              <>
                {/* The composer is where this is normally set, but that only
                    exists with an app open — so it is settable here too. */}
                <Field
                  label="Agent permissions"
                  hint={describePermissionMode(permissionMode).hint}
                >
                  <PermissionModeControl
                    mode={permissionMode}
                    onModeChange={onModeChange}
                  />
                </Field>

                <Field
                  label="Ollama server"
                  hint="anyapp runs entirely on local models. No API key is needed."
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.ollamaBaseUrl}
                      onChange={(e) =>
                        setConfig({ ...config, ollamaBaseUrl: e.target.value })
                      }
                      placeholder="http://localhost:11434"
                      className={FIELD_CLASS}
                    />
                    <button
                      onClick={() => refreshModels(config.ollamaBaseUrl)}
                      disabled={refreshing}
                      className="shrink-0 rounded-lg border border-line px-3 py-2 text-[13px] text-bone transition-colors hover:border-ash disabled:opacity-50"
                    >
                      {refreshing ? 'Checking…' : 'Check'}
                    </button>
                  </div>
                </Field>

                <Field label="Model">
                  {reachable && models.length > 0 ? (
                    <>
                      <select
                        value={config.ollamaModel ?? ''}
                        onChange={(e) =>
                          setConfig({ ...config, ollamaModel: e.target.value || null })
                        }
                        className={FIELD_CLASS}
                      >
                        <option value="">Select a model…</option>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.parameterSize
                              ? `${model.id} (${model.parameterSize})`
                              : model.id}
                            {model.supportsTools ? '' : ' — no tool support'}
                          </option>
                        ))}
                      </select>
                      {selectedLacksTools ? (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-bone">
                          <span className="mt-px shrink-0 text-brass">
                            <WarningIcon size={14} />
                          </span>
                          This model cannot call tools, so the agent will be able to talk
                          but not read or change files.
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[12px] text-ash">
                          The agent needs a model that supports tool calling — qwen3-coder,
                          llama3.1, gpt-oss, or mistral-nemo.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="rounded-lg border border-brass/40 bg-brass/10 p-3">
                      {reachable ? (
                        <>
                          <p className="text-[13px] text-bone">
                            Ollama is running, but no models are pulled.
                          </p>
                          <pre className="mt-2 font-mono text-[12px] text-ash">
                            ollama pull qwen3-coder:30b
                          </pre>
                        </>
                      ) : (
                        <>
                          <p className="text-[13px] text-bone">
                            Ollama is not reachable at{' '}
                            <span className="font-mono">{config.ollamaBaseUrl}</span>.
                          </p>
                          <pre className="mt-2 font-mono text-[12px] text-ash">
                            ollama serve{'\n'}ollama pull qwen3-coder:30b
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </Field>

                <Field label="Theme">
                  <select
                    value={config.theme}
                    onChange={(e) =>
                      setConfig({ ...config, theme: e.target.value as AppConfig['theme'] })
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System</option>
                  </select>
                </Field>

                <div className="mt-5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={config.autoCommit}
                      onChange={(e) =>
                        setConfig({ ...config, autoCommit: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-raised accent-[var(--color-brass)]"
                    />
                    <span>
                      <span className="block text-[12.5px] font-medium text-bone">
                        Commit every change the agent makes
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ash">
                        Each write becomes its own commit, so anything can be rolled back
                        from History.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-7 flex items-center gap-3">
                  <button
                    onClick={saveConfig}
                    className="flex items-center gap-1.5 rounded-lg bg-brass px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
                  >
                    Save settings
                  </button>
                  {saved && (
                    <span className="flex items-center gap-1 text-[12.5px] text-patina">
                      <CheckIcon size={14} />
                      Saved
                    </span>
                  )}
                </div>
              </>
            ))}

          {tab === 'sources' && <SourcesPanel />}

          {tab === 'about' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-[14px] font-semibold text-bone">anyapp 0.1.0</h2>
                <p className="mt-1 text-[13px] text-ash">
                  A self-modifying desktop app. The agent reads and writes its own source
                  and the source of the apps it creates, entirely on local models.
                </p>
              </div>
              <div>
                <p className="eyebrow text-ash">Workspace</p>
                <p className="mt-1 font-mono text-[12.5px] text-bone">~/.anyapp/</p>
                <p className="mt-1 text-[12px] text-ash">
                  Apps, skills, sources, and chat history are all stored here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
