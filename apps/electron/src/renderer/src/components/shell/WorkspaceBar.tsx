import { PanelsMenu } from './PanelsMenu'
import { BranchIcon, CloseIcon } from '../icons'
import type { DockviewApi } from 'dockview-react'
import type { SubApp } from '@pitaster/core'

/**
 * Props for the WorkspaceBar component.
 */
interface WorkspaceBarProps {
  /** The focused app. */
  app: SubApp
  /** The dock's API, or null until it is ready. */
  api: DockviewApi | null
  /** Release focus on this app and return to the library. */
  onCloseApp: () => void
}

/**
 * The strip above the dock: what you are working on, and what is shown.
 *
 * It exists because `AppContextColumn` no longer does. That column carried the
 * app's git state and the button that closed it, and dissolving it into dockable
 * panels left both homeless — the header above cannot take them, since it is the
 * window's only draggable chrome and its whole design is that it holds no
 * controls at all.
 *
 * `no-drag` regardless, because the bar sits directly under that drag region and
 * a stray drag surface here would swallow clicks on the menu.
 */
export function WorkspaceBar({ app, api, onCloseApp }: WorkspaceBarProps) {
  return (
    <div className="no-drag flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      {app.currentBranch && (
        <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-ash">
          <BranchIcon size={12} className="shrink-0" />
          <span className="truncate">{app.currentBranch}</span>
          {app.hasChanges && (
            <span
              className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brass"
              title="Uncommitted changes"
            />
          )}
        </span>
      )}

      <div className="flex-1" />

      <PanelsMenu api={api} />

      <button
        onClick={onCloseApp}
        title={`Close ${app.name}`}
        className="shrink-0 rounded p-1 text-ash transition-colors hover:text-bone"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
