import { PanelToggle } from './PanelToggle'
import { AppServerBlock } from './AppServerBlock'
import { ChatSessionList } from '../ChatSessionList'
import { HistoryIcon, TerminalIcon, PreviewIcon, BranchIcon, CloseIcon } from '../icons'
import type { SubApp } from '@anyapp/core'
import type { RightPanel, BottomPanel } from '../../types/navigation'

/**
 * Props for the AppContextColumn component.
 */
interface AppContextColumnProps {
  /** The focused app. The column only renders when there is one. */
  app: SubApp
  /** Whether the workspace (chat) is the current main panel. */
  inWorkspace: boolean
  /** Return to the focused app's workspace. */
  onOpenWorkspace: () => void
  /** Release focus on this app and return to the library. */
  onCloseApp: () => void
  /** The active chat session, or null while one is being resolved. */
  activeSessionId: string | null
  /** Switch to a chat session. */
  onSessionSelect: (sessionId: string) => void
  /** Start a new chat session. */
  onSessionCreate: () => void
  /** The open right-docked panel. */
  rightPanel: RightPanel
  /** The open bottom-docked panel. */
  bottomPanel: BottomPanel
  /** Open or close the right-docked panel. */
  onToggleRightPanel: (panel: NonNullable<RightPanel>) => void
  /** Open or close the bottom-docked panel. */
  onToggleBottomPanel: (panel: NonNullable<BottomPanel>) => void
}

/**
 * Everything scoped to the focused app, in one column headed by that app's name.
 *
 * This is the answer to nav items that were "contextual" only by being disabled:
 * the app's chats and its inspectors now live in a column that appears with the
 * app and is titled after it, while the rail beside it holds only things that
 * exist without an app.
 */
export function AppContextColumn({
  app,
  inWorkspace,
  onOpenWorkspace,
  onCloseApp,
  activeSessionId,
  onSessionSelect,
  onSessionCreate,
  rightPanel,
  bottomPanel,
  onToggleRightPanel,
  onToggleBottomPanel
}: AppContextColumnProps) {
  return (
    <div className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
      {/* The column's heading is the app's own name. */}
      <div
        className={`group/head flex items-start gap-1 border-b border-line px-4 py-3 transition-colors ${
          inWorkspace ? 'bg-raised/40' : ''
        }`}
      >
        <button
          onClick={onOpenWorkspace}
          aria-current={inWorkspace ? 'page' : undefined}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        >
          <span className="eyebrow w-full truncate text-brass">{app.name}</span>
          {app.currentBranch && (
            <span className="flex w-full items-center gap-1 font-mono text-[11px] text-ash">
              <BranchIcon size={12} className="shrink-0" />
              <span className="truncate">{app.currentBranch}</span>
              {app.hasChanges && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass"
                  title="Uncommitted changes"
                />
              )}
            </span>
          )}
        </button>
        <button
          onClick={onCloseApp}
          title={`Close ${app.name}`}
          className="shrink-0 rounded p-1 text-ash opacity-0 transition-opacity hover:text-bone group-hover/head:opacity-100 group-focus-within/head:opacity-100"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Chats */}
      <ChatSessionList
        activeSessionId={activeSessionId}
        onSessionSelect={onSessionSelect}
        onSessionCreate={onSessionCreate}
      />

      {/* The app's own dev server, directly above the Preview toggle that shows it */}
      <AppServerBlock appId={app.id} template={app.template} />

      {/* Inspectors on the workspace */}
      <div className="border-t border-line px-2 py-3">
        <p className="eyebrow px-2 pb-2 text-ash">Panels</p>
        <PanelToggle
          icon={<HistoryIcon size={16} />}
          label="History"
          open={rightPanel === 'versions'}
          onClick={() => onToggleRightPanel('versions')}
        />
        <PanelToggle
          icon={<TerminalIcon size={16} />}
          label="Terminal"
          open={bottomPanel === 'terminal'}
          onClick={() => onToggleBottomPanel('terminal')}
        />
        <PanelToggle
          icon={<PreviewIcon size={16} />}
          label="Preview"
          open={bottomPanel === 'preview'}
          onClick={() => onToggleBottomPanel('preview')}
        />
      </div>
    </div>
  )
}
