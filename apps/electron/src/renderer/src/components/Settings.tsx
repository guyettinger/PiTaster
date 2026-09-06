/**
 * Settings: everything that configures the workspace rather than one app.
 */

import { useState, useEffect, useCallback } from 'react'
import { SourcesPanel } from './SourcesPanel'
import { WorkspaceSkillsSettings } from './skills/WorkspaceSkillsSettings'
import { ModelTab } from './settings/ModelTab'
import { AgentTab } from './settings/AgentTab'
import { GeneralTab } from './settings/GeneralTab'
import { DEFAULT_CONFIG } from './settings/types'
import { WarningIcon, CheckIcon } from './icons'
import type { AppConfig, OllamaModel } from './settings/types'
import type { PermissionMode } from '../types/electron'

export type { AppConfig, OllamaModel } from './settings/types'

/** The sections of Settings. */
type SettingsTab = 'model' | 'agent' | 'skills' | 'sources' | 'general'

/**
 * Tab order and labels.
 *
 * `savesConfig` marks the tabs the Save button belongs to. Sources and Skills
 * write on their own actions — adding a source connects it, saving a skill
 * writes the file — so a Save button under them would imply their changes were
 * still pending when they are already on disk.
 */
const TABS: { id: SettingsTab; label: string; savesConfig: boolean }[] = [
  { id: 'model', label: 'Model', savesConfig: true },
  { id: 'agent', label: 'Agent', savesConfig: true },
  { id: 'skills', label: 'Skills', savesConfig: false },
  { id: 'sources', label: 'Sources', savesConfig: false },
  { id: 'general', label: 'General', savesConfig: true }
]

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
 * Settings for the workspace: the model the agent runs on, how it behaves, the
 * skills every app is offered, and the MCP sources it can reach.
 *
 * This component owns the configuration and the tab chrome; each tab renders it.
 * The split is by *audience* rather than by type. Model is what a person opens
 * when a turn will not start; Agent is what they open when it starts and does
 * the wrong thing. Running them down one column — as a single General tab did,
 * with the tool set wedged between the context window and the temperature — made
 * every visit a scroll past the half that was not the question.
 *
 * Skills and Sources live here rather than in the nav rail because both are
 * workspace-wide data under `~/.keylimepi`, not scoped to the app you have open.
 * The per-app half of skills — which ones are on, which is `SubApp.disabledSkills`
 * — is in each app's own Skills panel, where there is an app to scope it to.
 */
export function Settings({ permissionMode, onModeChange }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>('model')
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [models, setModels] = useState<OllamaModel[]>([])
  // Null until the first probe answers. Initialising to `true` made the page open
  // claiming Ollama was running — including when it was not — and then correct itself
  // a moment later, which reads as a flicker rather than as a check.
  const [reachable, setReachable] = useState<boolean | null>(null)
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

  // One patch function for every tab, so a tab never has to restate the whole
  // config to change one field — which is how a stale copy overwrites a
  // neighbouring setting someone changed a moment earlier.
  const patchConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((current) => ({ ...current, ...patch }))
  }, [])

  const handleCheck = useCallback(() => {
    void refreshModels(config.ollamaBaseUrl)
  }, [config.ollamaBaseUrl, refreshModels])

  const showSave = TABS.find((entry) => entry.id === tab)?.savesConfig ?? false

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
                tab === entry.id ? 'text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
              }`}
            >
              {entry.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-keylime transition-opacity ${
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

          {loading && showSave ? (
            <p className="text-[13px] text-ash">Loading settings…</p>
          ) : (
            <>
              {tab === 'model' && (
                <ModelTab
                  config={config}
                  onChange={patchConfig}
                  models={models}
                  reachable={reachable}
                  refreshing={refreshing}
                  onCheck={handleCheck}
                />
              )}

              {tab === 'agent' && (
                <AgentTab
                  config={config}
                  onChange={patchConfig}
                  permissionMode={permissionMode}
                  onModeChange={onModeChange}
                />
              )}

              {tab === 'skills' && <WorkspaceSkillsSettings />}

              {tab === 'sources' && <SourcesPanel />}

              {tab === 'general' && <GeneralTab config={config} onChange={patchConfig} />}

              {showSave && (
                <div className="mt-7 flex items-center gap-3">
                  <button
                    onClick={saveConfig}
                    className="flex items-center gap-1.5 rounded-lg bg-keylime px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
