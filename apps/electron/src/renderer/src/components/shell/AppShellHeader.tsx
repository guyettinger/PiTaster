import { Logo } from '../Logo'
import { describePermissionMode } from '../PermissionModeControl'
import type { SubApp } from '@keylimepi/core'
import type { PermissionMode } from '../../types/electron'

/**
 * The header's bottom hairline, per permission mode. Static class names so
 * Tailwind's scanner sees them. `bypassPermissions` is the only mode that
 * thickens the line — it is the only one with no gate at all.
 */
const HAIRLINE_CLASS = {
  patina: 'h-[2px] bg-patina',
  keylime: 'h-[2px] bg-keylime',
  rust: 'h-[3px] bg-rust'
} as const

/**
 * Props for the AppShellHeader component.
 */
interface AppShellHeaderProps {
  /** The focused app, or null when none is open. */
  app: SubApp | null
  /** The agent's permission mode. */
  permissionMode: PermissionMode
}

/**
 * The app shell header.
 *
 * This is the window's only draggable chrome — `titleBarStyle: 'hiddenInset'`
 * removes the native title bar, so without this the window could not be moved
 * at all. It carries no controls: the agent's permission mode is set in the
 * composer that sends to it, and the app's dev server is run from the app's own
 * column, so the whole bar is free to drag.
 *
 * What it still does is state, at a glance, what is open and how much rope the
 * agent has: the title names the focused app, and the bottom hairline is
 * colored by the permission mode, readable from every view.
 */
export function AppShellHeader({ app, permissionMode }: AppShellHeaderProps) {
  const mode = describePermissionMode(permissionMode)

  return (
    <div className="shrink-0">
      {/* `pl-titlebar` clears the macOS traffic lights — see globals.css. */}
      <header className="drag flex h-11 items-center gap-3 bg-panel pl-titlebar pr-3">
        <div className="flex items-center gap-2">
          <Logo size={19} />
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-bone">Key Lime Pi</span>
        </div>

        {app && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-line" />
            <h1 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-bone">
              {app.name}
            </h1>
          </>
        )}
      </header>

      <div
        role="status"
        aria-label={`Agent permission mode: ${mode.label}`}
        title={`${mode.label} — ${mode.hint}`}
        className={`transition-colors duration-150 ${HAIRLINE_CLASS[mode.accent]}`}
      />
    </div>
  )
}
