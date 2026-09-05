import { PermissionModeControl, describePermissionMode } from '../PermissionModeControl'
import { FIELD_CLASS, Field, Checkbox } from './controls'
import type { PermissionMode } from '../../types/electron'
import type { AppConfig } from './types'

/**
 * Props for the AgentTab component.
 */
interface AgentTabProps {
  /** The configuration being edited. */
  config: AppConfig
  /** Apply a change to the configuration. */
  onChange: (patch: Partial<AppConfig>) => void
  /** The agent's permission mode. */
  permissionMode: PermissionMode
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
}

/**
 * How the agent behaves: what it may do, what it is given, what it records.
 *
 * These are the settings about the *agent* rather than the model underneath it,
 * which is the split this tab exists to draw. A person tuning a temperature and a
 * person deciding whether writes commit themselves are doing different jobs, and
 * the old single column made them scroll past each other's.
 *
 * Permission mode is here as well as in the composer because the composer only
 * exists with an app open.
 */
export function AgentTab({ config, onChange, permissionMode, onModeChange }: AgentTabProps) {
  return (
    <>
      <Field label="Agent permissions" hint={describePermissionMode(permissionMode).hint}>
        <PermissionModeControl mode={permissionMode} onModeChange={onModeChange} />
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
            onChange({ toolProfile: e.target.value as AppConfig['toolProfile'] })
          }
          className={FIELD_CLASS}
        >
          <option value="auto">Automatic</option>
          <option value="lean">Lean</option>
          <option value="full">Full</option>
        </select>
      </Field>

      <Checkbox
        label="Trim what the agent is sent"
        hint="Shortens long tool output, collapses files read more than once, and drops old screenshots. Only affects what reaches the model — the transcript and history keep everything."
        checked={config.trimContext}
        onChange={(trimContext) => onChange({ trimContext })}
      />

      <Checkbox
        label="Commit every change the agent makes"
        hint="Each write becomes its own commit, so anything can be rolled back from History."
        checked={config.autoCommit}
        onChange={(autoCommit) => onChange({ autoCommit })}
      />

      <Checkbox
        label="Name new chats from their first message"
        hint="One short local call after the first reply, once per chat. Off, a chat is still named after its first message, just uncondensed."
        checked={config.autoTitleChats}
        onChange={(autoTitleChats) => onChange({ autoTitleChats })}
      />
    </>
  )
}
