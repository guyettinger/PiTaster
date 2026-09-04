import { useCallback, useMemo, useState } from 'react'
import { DockviewReact } from 'dockview-react'
import { WorkspaceBar } from '../shell/WorkspaceBar'
import { WorkspaceProvider } from './WorkspaceContext'
import { EmptyDock } from './EmptyDock'
import { WORKSPACE_COMPONENTS } from './panels'
import { PITASTER_DOCKVIEW_THEME } from './theme'
import { openCodePanel, openSingletonPanel } from './actions'
import { WORKSPACE_PANEL_KINDS } from './catalog'
import { useWorkspaceLayout } from '../../hooks/useWorkspaceLayout'
import type { WorkspaceContextValue } from './WorkspaceContext'
import type { WorkspacePanelName } from './catalog'
import type { PermissionMode } from '../../types/electron'
import type { SubApp } from '@pitaster/core'

/**
 * Props for the Workspace component.
 */
interface WorkspaceProps {
  /** The focused app. */
  app: SubApp
  /** The agent's permission mode. */
  permissionMode: PermissionMode
  /** The active chat session, or null while one is being resolved. */
  activeSessionId: string | null
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
  /** Switch to a chat session. */
  onSessionSelect: (sessionId: string) => void
  /** Start a new chat session. */
  onSessionCreate: () => void
  /** Roll the app back to a commit. */
  onRollback: (commitId: string) => void
  /** Switch to a branch. */
  onBranchSwitch: (branchName: string) => void
  /** Create a branch. */
  onBranchCreate: (name: string) => void
  /** Leave the workspace for the Skills destination. */
  onOpenSkills: () => void
  /** Release focus on this app and return to the library. */
  onCloseApp: () => void
}

/**
 * The focused app's workspace: a dock of panels the user arranges.
 *
 * Everything the old shell hard-coded — the chat in the middle, History pinned
 * right at a width nobody could change, Terminal and Preview taking turns in a
 * drawer — is a panel here, and where they sit is remembered per app.
 *
 * Two things about this component are load-bearing rather than incidental.
 *
 * Panels are added with `renderer: 'always'`, so dockview keeps each one's
 * element attached to a single stable overlay and *repositions* it instead of
 * re-parenting it. That is what lets the Preview panel hold an Electron
 * `<webview>` at all: re-parenting a webview destroys its `WebContents`, so
 * under any other layout library the running app would reload on every drag.
 *
 * And this component is never unmounted while an app is focused — the
 * destinations in the nav rail draw *over* it. Unmounting would take the
 * webview with it and drop the transcript's in-flight state, which is precisely
 * the bug the dock exists to fix.
 */
export function Workspace({
  app,
  permissionMode,
  activeSessionId,
  onModeChange,
  onSessionSelect,
  onSessionCreate,
  onRollback,
  onBranchSwitch,
  onBranchCreate,
  onOpenSkills,
  onCloseApp
}: WorkspaceProps) {
  const { api, onReady } = useWorkspaceLayout(app.id)

  const openFile = useCallback(
    (path: string) => {
      if (api) openCodePanel(api, path)
    },
    [api]
  )

  // Opening an instrument panel from the gauge that summarizes it. The gauge names a
  // panel kind rather than holding the dock's API, so the composer stays ignorant of
  // dockview — the same separation `openFile` already draws.
  const openPanel = useCallback(
    (name: WorkspacePanelName) => {
      const kind = WORKSPACE_PANEL_KINDS.find((candidate) => candidate.name === name)
      if (api && kind) openSingletonPanel(api, kind)
    },
    [api]
  )

  // A rollback or a branch switch moves HEAD, which invalidates the composer's
  // changed-files strip — it is a diff against a fixed commit. Wrapping the two
  // callbacks here rather than counting in `App` keeps the whole concern beside
  // the context that carries it: `App` still just does the thing and knows nothing
  // about who is measuring against it.
  const [changesRevision, setChangesRevision] = useState(0)

  const handleRollback = useCallback(
    (commitId: string) => {
      onRollback(commitId)
      setChangesRevision((revision) => revision + 1)
    },
    [onRollback]
  )

  const handleBranchSwitch = useCallback(
    (branchName: string) => {
      onBranchSwitch(branchName)
      setChangesRevision((revision) => revision + 1)
    },
    [onBranchSwitch]
  )

  // Memoized because panels render inside dockview's own tree rather than as
  // children of this component: a value rebuilt each render would re-render all
  // of them, transcript included, on every keystroke that reaches App.
  const contextValue = useMemo<WorkspaceContextValue>(
    () => ({
      app,
      permissionMode,
      activeSessionId,
      onModeChange,
      onSessionSelect,
      onSessionCreate,
      onRollback: handleRollback,
      onBranchSwitch: handleBranchSwitch,
      onBranchCreate,
      onOpenSkills,
      openFile,
      openPanel,
      changesRevision
    }),
    [
      app,
      permissionMode,
      activeSessionId,
      onModeChange,
      onSessionSelect,
      onSessionCreate,
      handleRollback,
      handleBranchSwitch,
      onBranchCreate,
      onOpenSkills,
      openFile,
      openPanel,
      changesRevision
    ]
  )

  return (
    <WorkspaceProvider value={contextValue}>
      <WorkspaceBar app={app} api={api} onCloseApp={onCloseApp} />
      {/*
        `isolate` contains every z-index dockview uses — including the 999 its
        floating layer reserves — inside this subtree, so a destination page
        drawn over the workspace stays over it.

        `overflow-clip` is not cosmetic, and it has to be `clip` rather than
        `hidden`. Every panel renders into an absolutely positioned overlay, and
        a panel dockview has not positioned yet keeps `.dv-render-overlay`'s
        default 100%/100% at the end of the flow — so with this box left visible
        the overlays counted double toward the scroll height of everything above
        it: 1436px of content in a 718px box. Nothing draws a scrollbar, so the
        only symptom was the transcript's `scrollIntoView` silently scrolling the
        shell on load and dragging the workspace bar off the top of the window.
        `hidden` does not fix it — a hidden box is still a scroll container, so
        the scroll simply moved here from `main`. Clip cannot scroll at all.
      */}
      <div className="isolate min-h-0 flex-1 overflow-clip">
        <DockviewReact
          theme={PITASTER_DOCKVIEW_THEME}
          components={WORKSPACE_COMPONENTS}
          onReady={onReady}
          watermarkComponent={EmptyDock}
          disableFloatingGroups={true}
        />
      </div>
    </WorkspaceProvider>
  )
}
