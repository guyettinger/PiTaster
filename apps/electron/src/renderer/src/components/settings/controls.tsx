import type { ReactNode } from 'react'
import type { SamplingSetting } from '../../types/electron'
import type { OllamaModel } from './types'

/** Shared input styling, so every field in Settings matches. */
export const FIELD_CLASS =
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
  children: ReactNode
}

/**
 * One labelled setting.
 *
 * `max-w-xl` caps the measure on the control rather than on the page, which is
 * the rule pages follow throughout: a right-aligned action and the content it
 * acts on share the page gutter, and only running text and inputs are narrowed.
 */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="mt-5 max-w-xl">
      <label className="block text-[12.5px] font-medium text-bone">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[12px] text-ash">{hint}</p>}
    </div>
  )
}

/**
 * Props for the Checkbox component.
 */
interface CheckboxProps {
  /** The setting's label. */
  label: string
  /** One or two lines on what turning it on does. */
  hint: string
  /** Whether it is on. */
  checked: boolean
  /** Report a change. */
  onChange: (checked: boolean) => void
}

/**
 * One on/off setting.
 *
 * Extracted because the four that existed were four copies of the same fourteen
 * lines, and they had already drifted apart in whitespace.
 */
export function Checkbox({ label, hint, checked, onChange }: CheckboxProps) {
  return (
    <div className="mt-5">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-raised accent-[var(--color-keylime)]"
        />
        <span>
          <span className="block text-[12.5px] font-medium text-bone">{label}</span>
          <span className="mt-0.5 block text-[12px] text-ash">{hint}</span>
        </span>
      </label>
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
 * meant "the model's own default" there was nowhere left to say "let Key Lime Pi choose".
 * That is how one baked-in number came to be sent to every model regardless of whether
 * it reasons. The mode is chosen explicitly and the number appears only when it is
 * being pinned.
 */
export function SamplingControl({ value, min, max, step, onChange }: SamplingControlProps) {
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
export function describeSampling(
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
  // corrected. Key Lime Pi's old default was a pinned 0, which is indistinguishable on disk
  // from a 0 someone chose — so an install that predates this control keeps decoding
  // greedily, including on a reasoning model, and nothing would otherwise say so.
  if (recommended !== null && value !== recommended) {
    return `${pinned} Recommended for this model: ${recommended}.`
  }
  return pinned
}

/**
 * Explain where the context window Key Lime Pi will use came from.
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
export function describeContextWindow(model: OllamaModel | undefined): string {
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
