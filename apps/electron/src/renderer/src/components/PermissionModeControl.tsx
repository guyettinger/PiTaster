import { ChevronDownIcon } from './icons'
import type { PermissionMode } from '../types/electron'

/**
 * A permission mode as the interface presents it.
 */
export interface PermissionModeDescriptor {
  /** The mode the agent runs in. */
  id: PermissionMode
  /** How the mode is named everywhere in the UI. */
  label: string
  /** What the mode actually permits, in one line. */
  hint: string
  /** The token the shell header's hairline takes in this mode. */
  accent: 'patina' | 'brass' | 'rust'
}

/**
 * Every permission mode, in ascending order of how much the agent may do.
 *
 * This is the single source of truth for mode wording: the header control, the
 * hairline color, and the chat empty state all read from it, so the mode is
 * named the same way wherever it appears.
 */
export const PERMISSION_MODES: readonly PermissionModeDescriptor[] = [
  {
    id: 'plan',
    label: 'Explore',
    hint: 'Reads files. Changes nothing.',
    accent: 'patina'
  },
  {
    id: 'default',
    label: 'Ask to edit',
    hint: 'Asks before every tool it runs.',
    accent: 'brass'
  },
  {
    id: 'acceptEdits',
    label: 'Auto edit',
    hint: 'Writes files without asking. Still asks to run commands.',
    accent: 'brass'
  },
  {
    id: 'bypassPermissions',
    label: 'Auto — all',
    hint: 'Runs everything without asking, including shell commands.',
    accent: 'rust'
  }
]

/**
 * Looks up a mode's descriptor.
 *
 * @param mode - The active permission mode
 * @returns The descriptor for that mode, falling back to `default`
 */
export function describePermissionMode(mode: PermissionMode): PermissionModeDescriptor {
  return PERMISSION_MODES.find((entry) => entry.id === mode) ?? PERMISSION_MODES[1]
}

/** Dot color per accent. Static class names so Tailwind's scanner sees them. */
const DOT_CLASS: Record<PermissionModeDescriptor['accent'], string> = {
  patina: 'bg-patina',
  brass: 'bg-brass',
  rust: 'bg-rust'
}

/**
 * Props for the PermissionModeControl component.
 */
interface PermissionModeControlProps {
  /** The active permission mode. */
  mode: PermissionMode
  /** Callback when the user picks a different mode. */
  onModeChange: (mode: PermissionMode) => void
}

/**
 * Picks how much the agent is allowed to do.
 *
 * Sits in the composer that sends to the agent, where the choice takes effect
 * and where its approval prompts appear, and is mirrored in Settings so it is
 * still reachable with no app open. The shell header's mode-colored hairline
 * remains the always-visible readout.
 */
export function PermissionModeControl({ mode, onModeChange }: PermissionModeControlProps) {
  const active = describePermissionMode(mode)

  // `inline-flex`, not `flex`: the wrapper has to shrink to the select's own
  // width, or the absolutely-positioned chevron detaches to the right edge of
  // whatever block this is dropped into.
  return (
    <div className="relative inline-flex items-center">
      <span
        className={`pointer-events-none absolute left-2 h-1.5 w-1.5 rounded-full ${DOT_CLASS[active.accent]}`}
      />
      <select
        value={mode}
        onChange={(event) => onModeChange(event.target.value as PermissionMode)}
        title={active.hint}
        aria-label="Agent permission mode"
        className="appearance-none rounded border border-line bg-raised py-1 pl-6 pr-7 text-[12.5px] text-bone transition-colors hover:border-ash"
      >
        {PERMISSION_MODES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={14} className="pointer-events-none absolute right-2 text-ash" />
    </div>
  )
}
