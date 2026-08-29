/**
 * Settings panel for app configuration.
 */

import { useState, useEffect, useCallback } from 'react'

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

/**
 * Props for the Settings component.
 */
interface SettingsProps {
  /** Whether the settings panel is visible. */
  isVisible?: boolean
}

/** Default configuration used before the persisted one loads. */
const DEFAULT_CONFIG: AppConfig = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: null,
  theme: 'dark',
  autoCommit: true
}

/**
 * Settings panel for configuring the application.
 */
export function Settings({ isVisible = true }: SettingsProps) {
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
      setError('Failed to load settings')
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
      setError('Failed to save settings')
      console.error('Failed to save config:', err)
    }
  }, [config, refreshModels])

  const selectedLacksTools = models.some(
    (model) => model.id === config.ollamaModel && !model.supportsTools
  )

  if (!isVisible) return null

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-neutral-400">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg">
        <h2 className="text-xl font-semibold text-neutral-50">Settings</h2>

        {error && (
          <div className="mt-4 rounded bg-red-900/50 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Ollama server */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-neutral-200">
            Ollama Server
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={config.ollamaBaseUrl}
              onChange={(e) => setConfig({ ...config, ollamaBaseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => refreshModels(config.ollamaBaseUrl)}
              disabled={refreshing}
              className="shrink-0 rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50"
            >
              {refreshing ? 'Checking...' : 'Refresh'}
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            anyapp runs entirely on local models. No API key is needed.
          </p>
        </div>

        {/* Model */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-neutral-200">Model</label>
          {reachable && models.length > 0 ? (
            <>
              <select
                value={config.ollamaModel ?? ''}
                onChange={(e) =>
                  setConfig({ ...config, ollamaModel: e.target.value || null })
                }
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select a model...</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.parameterSize ? `${model.id} (${model.parameterSize})` : model.id}
                    {model.supportsTools ? '' : ' - no tool support'}
                  </option>
                ))}
              </select>
              {selectedLacksTools ? (
                <p className="mt-1 text-xs text-amber-300">
                  This model does not support tool calling, so the agent will be able to
                  talk but not read or edit files.
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  The agent needs a model that supports tool calling, such as qwen3-coder,
                  llama3.1, gpt-oss, or mistral-nemo.
                </p>
              )}
            </>
          ) : (
            <div className="mt-1 rounded border border-amber-800/60 bg-amber-900/20 p-3 text-sm text-amber-200">
              {reachable ? (
                <>
                  <p>Ollama is running, but no models are pulled.</p>
                  <p className="mt-2 font-mono text-xs text-amber-300/80">
                    ollama pull qwen3-coder:30b
                  </p>
                </>
              ) : (
                <>
                  <p>Ollama is not reachable at {config.ollamaBaseUrl}.</p>
                  <p className="mt-2 font-mono text-xs text-amber-300/80">
                    ollama serve
                    <br />
                    ollama pull qwen3-coder:30b
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Theme */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-neutral-200">
            Theme
          </label>
          <select
            value={config.theme}
            onChange={(e) => setConfig({ ...config, theme: e.target.value as AppConfig['theme'] })}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        {/* Auto Commit */}
        <div className="mt-6">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.autoCommit}
              onChange={(e) => setConfig({ ...config, autoCommit: e.target.checked })}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-900"
            />
            <span className="text-sm text-neutral-200">Auto-commit file changes</span>
          </label>
          <p className="mt-1 ml-7 text-xs text-neutral-500">
            Automatically commit changes made by the agent to git.
          </p>
        </div>

        {/* Project Root Info */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-neutral-200">
            Config Location
          </label>
          <p className="mt-1 text-sm text-neutral-400">
            <code className="rounded bg-neutral-800 px-1.5 py-0.5">~/.anyapp/</code>
          </p>
        </div>

        {/* Save Button */}
        <div className="mt-8">
          <button
            onClick={saveConfig}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-500"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>

        {/* Version Info */}
        <div className="mt-8 border-t border-neutral-800 pt-6">
          <p className="text-xs text-neutral-500">
            anyapp v0.1.0 - Self-Modifying Electron App
          </p>
        </div>
      </div>
    </div>
  )
}
