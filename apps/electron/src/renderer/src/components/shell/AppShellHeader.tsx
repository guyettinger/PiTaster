import { Logo } from '../Logo'
import { AppControls } from '../AppControls'
import { PermissionModeControl, describePermissionMode } from '../PermissionModeControl'
import { useRunningApps } from '../../context/RunningAppsContext'
import type { SubApp } from '@anyapp/core'
import type { PermissionMode } from '../../types/electron'

/**
 * The header's bottom hairline, per permission mode. Static class names so
 * Tailwind's scanner sees them. `bypassPermissions` is the only mode that
 * thickens the line — it is the only one with no gate at all.
 */
const HAIRLINE_CLASS = {
  patina: 'h-[2px] bg-patina',
  brass: 'h-[2px] bg-brass',
  rust: 'h-[3px] bg-rust'
} as const

/** Status dot color per run state. */
const STATUS_DOT: Record<string, string> = {
  running: 'bg-patina',
  starting: 'animate-pulse bg-brass',
  error: 'bg-rust',
  stopped: 'bg-ash'
}

/**
 * Props for the AppShellHeader component.
 */
interface AppShellHeaderProps {
  /** The focused app, or null when none is open. */
  app: SubApp | null
  /** The agent's permission mode. */
  permissionMode: PermissionMode
  /** Callback when the user changes the permission mode. */
  onModeChange: (mode: PermissionMode) => void
}

/**
 * The app shell header.
 *
 * This is the window's only draggable chrome — `titleBarStyle: 'hiddenInset'`
 * removes the native title bar, so without this the window could not be moved
 * at all. The bar drags; every control inside it opts back out with `no-drag`.
 *
 * Its bottom hairline is colored by the agent's permission mode, so the top of
 * the window always states how much rope the agent has, from any view.
 */
export function AppShellHeader({ app, permissionMode, onModeChange }: AppShellHeaderProps) {
  const { getStatus, getUrl } = useRunningApps()
  const mode = describePermissionMode(permissionMode)

  const status = app ? getStatus(app.id) : null
  const url = app ? getUrl(app.id) : null
  const port = status === 'running' && url ? new URL(url).port : null

  return (
    <div className="shrink-0">
      {/* The left padding clears the macOS traffic lights. */}
      <header className="drag flex h-11 items-center gap-3 bg-panel pl-[78px] pr-3">
        <div className="flex items-center gap-2">
          <Logo size={19} />
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-bone">anyapp</span>
        </div>

        {app && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-line" />
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-bone">
                {app.name}
              </h1>
              {status && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-raised px-2 py-0.5 text-[11px] text-ash">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-ash'}`}
                  />
                  <span className="font-mono">{port ? `:${port}` : status}</span>
                </span>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        <PermissionModeControl mode={permissionMode} onModeChange={onModeChange} />

        {app && (
          <div className="no-drag">
            <AppControls appId={app.id} template={app.template} size="sm" showLabels />
          </div>
        )}
      </header>

      <div className={`transition-colors duration-150 ${HAIRLINE_CLASS[mode.accent]}`} />
    </div>
  )
}
