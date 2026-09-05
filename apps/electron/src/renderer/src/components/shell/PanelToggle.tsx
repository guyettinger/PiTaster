import type { ReactNode } from 'react'

/**
 * Props for the PanelToggle component.
 */
interface PanelToggleProps {
  /** The panel's icon. */
  icon: ReactNode
  /** Visible label. */
  label: string
  /** Whether the panel is currently open. */
  open: boolean
  /** Open or close the panel. */
  onClick: () => void
}

/**
 * Opens and closes a docked panel alongside the workspace.
 *
 * A toggle is not a destination: it does not replace what you are looking at,
 * it adds to it. So it gets its own shape — a ring on the trailing edge that
 * fills when the panel is open — and reports `aria-pressed` rather than
 * `aria-current`. That difference is the whole point; the old rail used one
 * button shape for both behaviors, which is what made it unreadable.
 */
export function PanelToggle({ icon, label, open, onClick }: PanelToggleProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={open}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
        open ? 'text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
      }`}
    >
      <span className={open ? 'text-keylime' : ''}>{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full border transition-colors ${
          open ? 'border-keylime bg-keylime' : 'border-line'
        }`}
      />
    </button>
  )
}
