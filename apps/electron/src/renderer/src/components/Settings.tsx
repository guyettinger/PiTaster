/**
 * Settings: everything that configures the workspace rather than one app.
 */

import { useState, useEffect, useCallback } from 'react'
import { SourcesPanel } from './SourcesPanel'
import { PermissionModeControl, describePermissionMode } from './PermissionModeControl'
import { WarningIcon, CheckIcon } from './icons'
import { RECOMMENDED_SAMPLING } from '@pitaster/core'
import type { PermissionMode, SamplingSetting } from '../types/electron'

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
  /** Whether a new chat is named by the local model after its first turn. */
  autoTitleChats: boolean
  /** Context window to configure for the selected model, or null to discover it. */
  contextWindow: number | null
  /** Which tools the agent exposes; 'auto' picks from the context window. */
  toolProfile: 'auto' | 'lean' | 'full'
  /** Whether to shape the context sent to the model. */
  trimContext: boolean
  /** Sampling temperature for the model, or null for the model's own default. */
  samplingTemperature: SamplingSetting
  /** Nucleus cutoff, in the same three states as {@link samplingTemperature}. */
  samplingTopP: SamplingSetting
  /** How hard to ask the model to think; `unset` sends no `reasoning_effort`. */
  reasoningLevel: 'unset' | 'low' | 'medium' | 'high'
}

/**
 * A model pulled into the local Ollama instance.
 */
export interface OllamaModel {
  /** Model tag as Ollama reports it. */
  id: string
  /** Parameter size string reported by Ollama, for example `30.5B`. */
  parameterSize?: string
  /** Context window the model's metadata advertises: its architectural maximum. */
  contextWindow: number
  /** The window Pi Taster actually configures, probed from the daemon when it can be. */
  effectiveContextWindow: number
  /** Where the effective window came from. */
  contextWindowSource: 'user' | 'daemon' | 'fallback'
  /** Whether the model supports function calling. The agent's tools require it. */
  supportsTools: boolean
  /** Whether the model advertises Ollama's `thinking` capability. */
  supportsThinking: boolean
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
  autoCommit: true,
  autoTitleChats: true,
  contextWindow: null,
  toolProfile: 'auto',
  trimContext: true,
  samplingTemperature: 'auto',
  samplingTopP: 'auto',
  reasoningLevel: 'unset'
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
 * Props for the SamplingControl component.
 */
interface SamplingControlProps {
  /** The configured value. */
  value: SamplingSetting
  /** Lowest number the endpoint accepts. */
  min: number
  /** Highest number the endpoint accepts. */
  max: number
  /** Step for the number input. */
  step: number
  /** Report a new value. */
  onChange: (value: SamplingSetting) => void
}

/**
 * A sampling setting in its three states.
 *
 * A number input alone cannot express them: empty has to mean *something*, and when it
 * meant "the model's own default" there was nowhere left to say "let Pi Taster choose".
 * That is how one baked-in number came to be sent to every model regardless of whether
 * it reasons. The mode is chosen explicitly and the number appears only when it is
 * being pinned.
 */
function SamplingControl({ value, min, max, step, onChange }: SamplingControlProps) {
  const mode = value === 'auto' ? 'auto' : value === null ? 'none' : 'pinned'

  return (
    <div className="flex gap-2">
      <select
        value={mode}
        onChange={(e) => {
          if (e.target.value === 'auto') return onChange('auto')
          if (e.target.value === 'none') return onChange(null)
          // Land on the recommendation rather than on an empty box, so switching to
          // Pinned never sends a request with a value nobody chose.
          onChange(typeof value === 'number' ? value : min)
        }}
        className={FIELD_CLASS}
      >
        <option value="auto">Recommended</option>
        <option value="none">Model default</option>
        <option value="pinned">Pinned</option>
      </select>
      {mode === 'pinned' && (
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={typeof value === 'number' ? value : min}
          onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
          className={`${FIELD_CLASS} max-w-28`}
        />
      )}
    </div>
  )
}

/**
 * Say what a sampling setting is currently doing.
 *
 * The recommendation is only useful if a person can see what it chose: a field reading
 * "Recommended" that silently means 0.6 on one model and 0 on another is the same class
 * of problem as a control that does nothing.
 *
 * @param value - The configured value
 * @param recommended - What `Recommended` resolves to for the selected model
 * @param pinned - What to say about a pinned value
 * @returns One sentence
 */
function describeSampling(
  value: SamplingSetting,
  recommended: number | null,
  pinned: string
): string {
  if (value === 'auto') {
    return recommended === null
      ? 'Recommended for this model: send nothing, and let the model use its own default.'
      : `Recommended for this model: ${recommended}.`
  }
  if (value === null) {
    return "Sending nothing. Ollama takes the value from the model's Modelfile — usually 0.7 or higher."
  }
  // A pinned value that disagrees with the recommendation is said out loud rather than
  // corrected. Pi Taster's old default was a pinned 0, which is indistinguishable on disk
  // from a 0 someone chose — so an install that predates this control keeps decoding
  // greedily, including on a reasoning model, and nothing would otherwise say so.
  if (recommended !== null && value !== recommended) {
    return `${pinned} Recommended for this model: ${recommended}.`
  }
  return pinned
}

/**
 * Explain where the context window Pi Taster will use came from.
 *
 * Ollama advertises a model's architectural maximum, not what the daemon serves —
 * 262144 against a served 65536 is normal — and believing the advertised number means
 * the prompt is silently truncated instead of compacted. This hint says which number
 * is in force and why.
 *
 * Deliberately not shared with the main process: this needs `OllamaModel` and the
 * "it advertises N" clause, and the renderer cannot import from `src/main` anyway.
 *
 * @param model - The selected model, or undefined when none is chosen
 * @returns One sentence for the field's hint
 */
function describeContextWindow(model: OllamaModel | undefined): string {
  if (!model) {
    return 'Leave empty to use whatever the daemon reports for the selected model.'
  }

  const effective = model.effectiveContextWindow.toLocaleString()
  const advertised = model.contextWindow > 0 ? model.contextWindow.toLocaleString() : null

  switch (model.contextWindowSource) {
    case 'user':
      return `Using ${effective} tokens, set here. Clear the field to discover it instead.`
    case 'daemon':
      return `Using ${effective} tokens, reported by the daemon for the loaded model${
        advertised ? ` (it advertises ${advertised})` : ''
      }.`
    case 'fallback':
      return `Using ${effective} tokens — a conservative default, because the daemon has not loaded this model yet${
        advertised ? ` and it advertises ${advertised}, which is its maximum, not what it serves` : ''
      }.`
  }
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
 * configuration stored under `~/.pitaster/sources`, not something scoped to the
 * app you happen to have open.
 */
export function Settings({ permissionMode, onModeChange }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
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

  const selectedLacksTools = models.some(
    (model) => model.id === config.ollamaModel && !model.supportsTools
  )

  const selectedModel = models.find((model) => model.id === config.ollamaModel)
  // What `Recommended` resolves to. Read from the same constant `agent/sampling.ts`
  // sends, so the sentence and the request cannot disagree.
  const recommended = selectedModel?.supportsThinking
    ? RECOMMENDED_SAMPLING.thinking
    : RECOMMENDED_SAMPLING.plain

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
                  hint="Pi Taster runs entirely on local models. No API key is needed."
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
                  {reachable === null ? (
                    <p className="text-[13px] text-ash">Checking the daemon…</p>
                  ) : reachable && models.length > 0 ? (
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

                <Field
                  label="Context window"
                  hint={describeContextWindow(selectedModel)}
                >
                  <input
                    type="number"
                    // MIN_CONTEXT_WINDOW and MAX_CONTEXT_WINDOW in
                    // main/agent/context-budget.ts are the source of truth; the
                    // renderer cannot import from main, so these are mirrored the way
                    // electron.d.ts mirrors the preload bridge. A value outside them
                    // is rejected by `config:save`.
                    min={2048}
                    max={262144}
                    step={1024}
                    value={config.contextWindow ?? ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        contextWindow: e.target.value ? Number(e.target.value) : null
                      })
                    }
                    placeholder="Discover automatically"
                    className={FIELD_CLASS}
                  />
                </Field>

                <Field
                  label="Tool set"
                  hint={
                    config.toolProfile === 'auto'
                      ? 'Automatic drops the branch tools on a small context window. Every tool costs context on every request, and a long list makes a small model pick worse.'
                      : config.toolProfile === 'lean'
                        ? 'Branch tools are hidden from the agent. You can still branch and view history from Version Control.'
                        : 'Every tool is offered to the agent.'
                  }
                >
                  <select
                    value={config.toolProfile}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        toolProfile: e.target.value as AppConfig['toolProfile']
                      })
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="auto">Automatic</option>
                    <option value="lean">Lean</option>
                    <option value="full">Full</option>
                  </select>
                </Field>

                <Field
                  label="Temperature"
                  hint={describeSampling(
                    config.samplingTemperature,
                    recommended.temperature,
                    'Most of a coding turn is reproducing text that already exists exactly, which is what a low temperature is for.'
                  )}
                >
                  <SamplingControl
                    value={config.samplingTemperature}
                    // MIN_SAMPLING_TEMPERATURE and MAX_SAMPLING_TEMPERATURE in
                    // main/agent/sampling.ts are the source of truth; the renderer
                    // cannot import from main, so these are mirrored the way the
                    // context window bounds above are. `config:save` rejects anything
                    // outside them.
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={(samplingTemperature) =>
                      setConfig({ ...config, samplingTemperature })
                    }
                  />
                </Field>

                <Field
                  label="Top-p"
                  hint={describeSampling(
                    config.samplingTopP,
                    recommended.topP,
                    'Nucleus sampling. It does nothing at temperature 0, which is why the recommendation only sets it for a reasoning model.'
                  )}
                >
                  <SamplingControl
                    value={config.samplingTopP}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(samplingTopP) => setConfig({ ...config, samplingTopP })}
                  />
                </Field>

                {/* Only for a model that advertises `thinking`. On anything else Pi
                    never sends `reasoning_effort`, so the control would do nothing
                    and say nothing about why. */}
                {selectedModel?.supportsThinking && (
                  <Field
                    label="Reasoning effort"
                    hint={
                      config.reasoningLevel === 'unset'
                        ? 'Sends no reasoning_effort. This is not off — Ollama\u2019s models reason on every request, and its OpenAI-compatible endpoint has no switch that stops them.'
                        : 'Reasoning is produced before the answer and shares the output budget with it, so a higher setting costs time and tokens on every turn.'
                    }
                  >
                    <select
                      value={config.reasoningLevel}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          reasoningLevel: e.target.value as AppConfig['reasoningLevel']
                        })
                      }
                      className={FIELD_CLASS}
                    >
                      {/* Four values, not Pi's seven. The audit measured `medium`
                          coming back byte-identical to sending nothing, and the
                          levels above `high` collapsing into it. */}
                      <option value="unset">Unset</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </Field>
                )}

                <div className="mt-5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={config.trimContext}
                      onChange={(e) =>
                        setConfig({ ...config, trimContext: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-raised accent-[var(--color-brass)]"
                    />
                    <span>
                      <span className="block text-[12.5px] font-medium text-bone">
                        Trim what the agent is sent
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ash">
                        Shortens long tool output, collapses files read more than once,
                        and drops old screenshots. Only affects what reaches the model —
                        the transcript and history keep everything.
                      </span>
                    </span>
                  </label>
                </div>

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

                <div className="mt-5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={config.autoTitleChats}
                      onChange={(e) =>
                        setConfig({ ...config, autoTitleChats: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-raised accent-[var(--color-brass)]"
                    />
                    <span>
                      <span className="block text-[12.5px] font-medium text-bone">
                        Name new chats from their first message
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ash">
                        One short local call after the first reply, once per chat. Off,
                        a chat is still named after its first message, just uncondensed.
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
                <h2 className="text-[14px] font-semibold text-bone">Pi Taster 0.1.0</h2>
                <p className="mt-1 text-[13px] text-ash">
                  A desktop app for tasting Pi, the coding agent, on models served by
                  your own Ollama. It writes its own source and the source of the apps
                  it creates. No API key, and no inference request that leaves this
                  machine.
                </p>
              </div>
              <div>
                <p className="eyebrow text-ash">Workspace</p>
                <p className="mt-1 font-mono text-[12.5px] text-bone">~/.pitaster/</p>
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
