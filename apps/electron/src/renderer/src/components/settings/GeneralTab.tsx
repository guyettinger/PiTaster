import { FIELD_CLASS, Field } from './controls'
import type { AppConfig } from './types'

/**
 * Props for the GeneralTab component.
 */
interface GeneralTabProps {
  /** The configuration being edited. */
  config: AppConfig
  /** Apply a change to the configuration. */
  onChange: (patch: Partial<AppConfig>) => void
}

/**
 * The app itself: how it looks, and what it is.
 *
 * Theme has no other home once Model and Agent are separated — it is neither —
 * and a tab holding one select would be a tab nobody visits, so it shares this
 * one with what used to be About. That is the honest grouping: both are facts
 * about the application rather than about the agent or the daemon.
 */
export function GeneralTab({ config, onChange }: GeneralTabProps) {
  return (
    <>
      <Field label="Theme">
        <select
          value={config.theme}
          onChange={(e) => onChange({ theme: e.target.value as AppConfig['theme'] })}
          className={FIELD_CLASS}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </Field>

      <div className="mt-8 space-y-4 border-t border-line pt-6">
        <div>
          <h2 className="text-[14px] font-semibold text-bone">Key Lime Pi 0.1.0</h2>
          <p className="mt-1 max-w-prose text-[13px] text-ash">
            Delicious Pi, served locally — the coding agent, running on models served by
            your own Ollama. It writes its own source and the source of the apps it
            creates. No API key, and no inference request that leaves this machine.
          </p>
        </div>
        <div>
          <p className="eyebrow text-ash">Workspace</p>
          <p className="mt-1 font-mono text-[12.5px] text-bone">~/.keylimepi/</p>
          <p className="mt-1 text-[12px] text-ash">
            Apps, skills, sources, and chat history are all stored here.
          </p>
        </div>
      </div>
    </>
  )
}
