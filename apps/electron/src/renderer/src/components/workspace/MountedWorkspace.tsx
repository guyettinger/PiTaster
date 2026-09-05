import { useCallback, useEffect } from 'react'
import { Workspace } from './Workspace'
import type { PermissionMode } from '../../types/electron'
import type { SubApp } from '@pitaster/core'

/**
 * Props for the MountedWorkspace component.
 */
interface MountedWorkspaceProps {
  /** The open app this workspace belongs to. */
  app: SubApp
  /** Whether this is the workspace on screen. */
  focused: boolean
  /** This workspace's permission mode, as the shell currently knows it. */
  permissionMode: PermissionMode
  /** This workspace's active chat session, or null before one resolves. */
  activeSessionId: string | null
  /** Record a workspace's permission mode. Stable across renders. */
  onModeResolved: (appId: string, mode: PermissionMode) => void
  /** Record a workspace's active chat session. Stable across renders. */
  onSessionResolved: (appId: string, sessionId: string | null) => void
  /** Close this app's tile. */
  onCloseApp: (appId: string) => void
  /** Re-read the app record after something moved HEAD. */
  onAppChanged: (appId: string) => void
}

/**
 * One open app's workspace, mounted whether or not it is the one on screen.
 *
 * This component exists for a reason that is entirely about identity of callbacks.
 * `WorkspaceContext`'s value must stay memoized — panels render inside dockview's
 * tree, so a rebuilt value re-renders all of them including every transcript — and a
 * memoized value needs every callback in it to be stable. Callbacks bound to *one*
 * app cannot be built in `App`, which knows about several: a `useCallback` there
 * would have to close over an id from a list and would be rebuilt whenever the list
 * changed. Bound here, each one has a single app in scope and is stable for as long
 * as that app is open.
 *
 * The per-workspace state it resolves — the permission mode and the active chat
 * session — is reported *up* rather than kept here, because the shell needs the
 * focused app's copy of both: the header shows the mode, and Settings changes it.
 *
 * ## Hiding a background workspace
 *
 * Not `display: none`, and not `visibility: hidden` either.
 *
 * `display: none` takes the box out of layout, which breaks three things at once:
 * `Chat` auto-scrolls off `scrollHeight`, `CodeViewer`'s Monaco needs real
 * dimensions, and dockview measures its container to lay the grid out. All three
 * would come back wrong when the workspace was shown again.
 *
 * `visibility: hidden` is inherited, and a descendant may override it back to
 * `visible` — which dockview does, explicitly, on the overlay of every active panel.
 * Setting it here hides the chrome and leaves the panels painted on top of whatever
 * is focused. It is the one hiding mechanism that looks right and is not.
 *
 * `clip-path: inset(100%)` clips the whole subtree and cannot be overridden from
 * inside it, while leaving layout exactly as it was. `inert` takes the subtree out of
 * the tab order and stops it receiving pointer events, so a hidden workspace's
 * composer cannot be typed into or focused by mistake.
 *
 * What none of them do is unmount, and that is the point of Phase 6: the Preview
 * panel's `<webview>` keeps its `WebContents`, `Chat` keeps its transcript and its
 * pending approval, and `CodeViewer` keeps Monaco's undo stack — so a background
 * app's turn goes on filling in a dock nobody is looking at, and it is all still
 * there when its tile is clicked.
 */
export function MountedWorkspace({
  app,
  focused,
  permissionMode,
  activeSessionId,
  onModeResolved,
  onSessionResolved,
  onCloseApp,
  onAppChanged
}: MountedWorkspaceProps) {
  const appId = app.id

  // Bring this workspace up, once. `workspace:open` resolves the chat session the
  // manifest names — creating one only when there is none — and pushes the
  // transcript, which arrives below rather than being returned into state here, so
  // that a session change from any other cause takes the same path.
  useEffect(() => {
    let cancelled = false
    void window.electronAPI.openWorkspace(appId).catch(() => null)
    // The permission mode belongs to the workspace, not to the process: it is read
    // at every tool call, so one shared value meant a mode chosen for one app
    // widened what another app's in-flight turn could do.
    void window.electronAPI.getPermissionMode(appId).then((mode) => {
      if (!cancelled) onModeResolved(appId, mode)
    })
    return () => {
      cancelled = true
    }
  }, [appId, onModeResolved])

  // Subscribed per app, because the push names the workspace it is about. With
  // several mounted, an untagged subscription would let a background app's session
  // change rewrite the session pointer of the one on screen.
  useEffect(() => {
    return window.electronAPI.onChatSessionChanged(appId, (sessionId) => {
      onSessionResolved(appId, sessionId)
    })
  }, [appId, onSessionResolved])

  const handleModeChange = useCallback(
    async (mode: PermissionMode) => {
      const applied = await window.electronAPI.setPermissionMode(mode, appId)
      onModeResolved(appId, applied)
    },
    [appId, onModeResolved]
  )

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      await window.electronAPI.setActiveChatSession(sessionId, appId)
    },
    [appId]
  )

  const handleSessionCreate = useCallback(async () => {
    await window.electronAPI.createChatSession(undefined, appId)
    // The session list and the active session both arrive as pushes.
  }, [appId])

  const handleRollback = useCallback(
    async (commitId: string) => {
      await window.electronAPI.rollback(commitId, appId)
      onAppChanged(appId)
    },
    [appId, onAppChanged]
  )

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      await window.electronAPI.switchBranch(branchName, appId)
      onAppChanged(appId)
    },
    [appId, onAppChanged]
  )

  const handleBranchCreate = useCallback(
    async (name: string) => {
      await window.electronAPI.createBranch(name, appId)
      onAppChanged(appId)
    },
    [appId, onAppChanged]
  )

  const handleClose = useCallback(() => onCloseApp(appId), [appId, onCloseApp])

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={focused ? undefined : HIDDEN_STYLE}
      inert={!focused}
      aria-hidden={!focused}
    >
      <Workspace
        app={app}
        permissionMode={permissionMode}
        activeSessionId={activeSessionId}
        onModeChange={handleModeChange}
        onSessionSelect={handleSessionSelect}
        onSessionCreate={handleSessionCreate}
        onRollback={handleRollback}
        onBranchSwitch={handleBranchSwitch}
        onBranchCreate={handleBranchCreate}
        onCloseApp={handleClose}
      />
    </div>
  )
}

/**
 * How a background workspace is hidden. See the component's own notes for why it is
 * this and not `display` or `visibility`.
 *
 * A module constant so the object identity is stable — a fresh style object each
 * render is a new prop on the wrapper every time.
 */
const HIDDEN_STYLE: React.CSSProperties = { clipPath: 'inset(100%)' }
