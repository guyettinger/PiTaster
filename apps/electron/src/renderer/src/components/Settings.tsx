/**
 * Settings panel for app configuration.
 */

import { useState, useEffect, useCallback } from 'react'

/**
 * Application configuration.
 */
export interface AppConfig {
  /** Anthropic API key (masked in UI). */
  anthropicApiKey?: string
  /** UI theme preference. */
  theme: 'light' | 'dark' | 'system'
  /** Whether to auto-commit file changes. */
  autoCommit: boolean
}

/**
 * Props for the Settings component.
 */
interface SettingsProps {
  /** Whether the settings panel is visible. */
  isVisible?: boolean
}

/**
 * Settings panel for configuring the application.
 */
export function Settings({ isVisible = true }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig>({
    theme: 'dark',
    autoCommit: true
  })
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const loaded = await window.electronAPI.getConfig()
      setConfig(loaded)
      // Show masked API key if it exists
      setApiKey(loaded.anthropicApiKey ? '••••••••••••••••' : '')
    } catch (err) {
      setError('Failed to load settings')
      console.error('Failed to load config:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveConfig = useCallback(async () => {
    try {
      setError(null)
      const toSave: AppConfig = { ...config }
      
      // Only update API key if user entered a new one (not the masked value)
      if (apiKey && !apiKey.includes('•')) {
        toSave.anthropicApiKey = apiKey
      }
      
      await window.electronAPI.saveConfig(toSave)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError('Failed to save settings')
      console.error('Failed to save config:', err)
    }
  }, [config, apiKey])

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

        {/* API Key */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-neutral-200">
            Anthropic API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Required for Claude Agent SDK. Stored securely using system keychain.
          </p>
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
            <code className="rounded bg-neutral-800 px-1.5 py-0.5">~/.clirabbit/</code>
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
            CLIRabbit v0.1.0 - Self-Modifying Electron App
          </p>
        </div>
      </div>
    </div>
  )
}
