import { RECOMMENDED_SAMPLING } from '@pitaster/core'
import { WarningIcon } from '../icons'
import { useDaemonHealth } from '../../hooks/useDaemonHealth'
import {
  FIELD_CLASS,
  Field,
  SamplingControl,
  describeContextWindow,
  describeSampling
} from './controls'
import type { AppConfig, OllamaModel } from './types'

/**
 * Props for the ModelTab component.
 */
interface ModelTabProps {
  /** The configuration being edited. */
  config: AppConfig
  /** Apply a change to the configuration. */
  onChange: (patch: Partial<AppConfig>) => void
  /** Models the daemon reports, empty when it is unreachable. */
  models: OllamaModel[]
  /** Whether the daemon answered the last check; null before the first one. */
  reachable: boolean | null
  /** Whether a check is in flight. */
  refreshing: boolean
  /** Re-check the daemon at the configured URL. */
  onCheck: () => void
}

/**
 * Everything about the daemon and the model it serves.
 *
 * Split out from a General tab that ran permissions, the server URL, the model,
 * the context window, the tool set, two sampling controls, reasoning, trimming,
 * theme and two commit settings in one column — six daemon controls with the
 * tool set wedged through the middle of them. These six answer one question,
 * "what am I talking to and how", and they are the only ones a person touches
 * when a turn will not start.
 */
export function ModelTab({
  config,
  onChange,
  models,
  reachable,
  refreshing,
  onCheck
}: ModelTabProps) {
  const selectedModel = models.find((model) => model.id === config.ollamaModel)
  const selectedLacksTools = selectedModel !== undefined && !selectedModel.supportsTools

  // What `Recommended` resolves to. Read from the same constant `agent/sampling.ts`
  // sends, so the sentence and the request cannot disagree.
  const recommended = selectedModel?.supportsThinking
    ? RECOMMENDED_SAMPLING.thinking
    : RECOMMENDED_SAMPLING.plain

  return (
    <>
      <DaemonStatus baseUrl={config.ollamaBaseUrl} />

      <Field
        label="Ollama server"
        hint="Pi Taster runs entirely on local models. No API key is needed."
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={config.ollamaBaseUrl}
            onChange={(e) => onChange({ ollamaBaseUrl: e.target.value })}
            placeholder="http://localhost:11434"
            className={FIELD_CLASS}
          />
          <button
            onClick={onCheck}
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
              onChange={(e) => onChange({ ollamaModel: e.target.value || null })}
              className={FIELD_CLASS}
            >
              <option value="">Select a model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.parameterSize ? `${model.id} (${model.parameterSize})` : model.id}
                  {model.supportsTools ? '' : ' — no tool support'}
                </option>
              ))}
            </select>
            {selectedLacksTools ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-bone">
                <span className="mt-px shrink-0 text-keylime">
                  <WarningIcon size={14} />
                </span>
                This model cannot call tools, so the agent will be able to talk but not
                read or change files.
              </p>
            ) : (
              <p className="mt-1.5 text-[12px] text-ash">
                The agent needs a model that supports tool calling — qwen3-coder,
                llama3.1, gpt-oss, or mistral-nemo.
              </p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-keylime/40 bg-keylime/10 p-3">
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

      <Field label="Context window" hint={describeContextWindow(selectedModel)}>
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
            onChange({ contextWindow: e.target.value ? Number(e.target.value) : null })
          }
          placeholder="Discover automatically"
          className={FIELD_CLASS}
        />
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
          onChange={(samplingTemperature) => onChange({ samplingTemperature })}
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
          onChange={(samplingTopP) => onChange({ samplingTopP })}
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
              ? 'Sends no reasoning_effort. This is not off — Ollama’s models reason on every request, and its OpenAI-compatible endpoint has no switch that stops them.'
              : 'Reasoning is produced before the answer and shares the output budget with it, so a higher setting costs time and tokens on every turn.'
          }
        >
          <select
            value={config.reasoningLevel}
            onChange={(e) =>
              onChange({ reasoningLevel: e.target.value as AppConfig['reasoningLevel'] })
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
    </>
  )
}

/**
 * Props for the DaemonStatus component.
 */
interface DaemonStatusProps {
  /** Where the daemon is expected, for the unreachable message. */
  baseUrl: string
}

/**
 * Whether the daemon is answering right now, and what it is holding.
 *
 * Settings used to probe the daemon exactly once, on mount, behind a Check
 * button — which is the one moment a person is *not* looking at this page when a
 * turn fails to start. The polling hook the composer's Daemon gauge already uses
 * was right here and unused, so this reads from it: the answer refreshes itself,
 * and it says the same thing in both places.
 *
 * It renders nothing while the first probe is outstanding. Claiming either state
 * before there is an answer is how the old flag came to open the page announcing
 * Ollama was running when it was not.
 */
function DaemonStatus({ baseUrl }: DaemonStatusProps) {
  const health = useDaemonHealth()
  if (health === null) return null

  if (!health.reachable) {
    return (
      <div className="mt-5 flex items-start gap-2 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rust" aria-hidden="true" />
        <p className="text-[12.5px] text-bone">
          Ollama is not answering at <span className="font-mono">{baseUrl}</span>. Start it
          with <code className="font-mono">ollama serve</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2">
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-patina"
        aria-hidden="true"
      />
      <p className="text-[12.5px] text-bone">
        Ollama is running.{' '}
        {health.modelLoaded ? (
          <>
            <span className="font-mono">{health.modelLoaded}</span> is loaded.
          </>
        ) : (
          <span className="text-ash">
            No model is resident — the next turn pays a full load.
          </span>
        )}
      </p>
    </div>
  )
}
