import type { ReactNode } from 'react'

/**
 * Props for the NavItem component.
 */
interface NavItemProps {
  /** The item's icon. */
  icon: ReactNode
  /** Visible label. Rail items show this under the icon; it is never a tooltip only. */
  label: string
  /** Whether this destination is the one currently shown. */
  active: boolean
  /** Navigate here. */
  onClick: () => void
}

/**
 * A destination in the global nav rail.
 *
 * Destinations replace the main view and carry a keylime bar on the leading edge
 * when active. Panel toggles look deliberately different — see `PanelToggle` —
 * because they do a different thing.
 */
export function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex w-full flex-col items-center gap-1 rounded-md py-2 transition-colors ${
        active ? 'text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-keylime transition-opacity ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {icon}
      <span className="eyebrow">{label}</span>
    </button>
  )
}
