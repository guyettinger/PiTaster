import { useState, useEffect, useCallback, useRef } from 'react'
import { Workspace } from './components/workspace/Workspace'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { AppListing } from './components/AppListing'
import { NoAppSelected } from './components/NoAppSelected'
import { AppShellHeader } from './components/shell/AppShellHeader'
import { NavRail } from './components/shell/NavRail'
import { RunningAppsProvider } from './context/RunningAppsContext'
import { useOpenApps } from './hooks/useOpenApps'
import type { Destination } from './types/navigation'
import type { PermissionMode } from './types/electron'
import type { SubApp } from '@pitaster/core'

/**
 * Root application component.
 *
 * Owns the shell's fixed chrome — the draggable header and the global nav rail —
 * and the state the focused app's workspace is built from. The workspace itself
 * is a dock; where its panels sit is the dock's business, and is remembered per
 * app rather than held here.
 *
 * Navigation is two-valued rather than one. `destination` names a page drawn
 * *over* the workspace, and `null` means nothing covers it — so focusing an app
 * is not navigation at all, which is why the rail no longer has a Workspace
 * item to navigate to.
 */
export function App() {
  // Which page, if any, covers the workspace. `null` shows the focused app.
  const [destination, setDestination] = useState<Destination | null>('apps')

  const { openApps, focusedApp, isRestoring, openApp, focusApp, closeApp, replaceApp } =
    useOpenApps()

  // Agent state
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Load initial permission mode
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
  }, [])

  // Tell main which app is focused, and wait for it to agree.
  //
  // Main still tracks exactly one active app — it is the confinement root every
  // path check is measured against — so focus is what selects it. Note this does
  // *not* fire when a destination covers the workspace: the workspace stays
  // mounted underneath, so the app it belongs to is still the open one.
  //
  // `syncedAppId` is what the workspace is gated on, and it is not ceremony. The
  // panels fetch app-scoped data the moment they mount — `skills:list` resolves
  // its scope from main's *active app*, not from an id the renderer sends — so
  // mounting them before this round trip lands makes those requests answer for
  // whichever app main still thought was open. That showed up as an app's own
  // skills being absent until something forced a reload, which reads as data
  // loss rather than as a race.
  const focusedAppId = focusedApp?.id ?? null
  const [syncedAppId, setSyncedAppId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setActiveSessionId(null) // Refilled by the chat:session-changed push below.
    setSyncedAppId(null)
    void window.electronAPI.setActiveApp(focusedAppId).then(() => {
      if (!cancelled) setSyncedAppId(focusedAppId)
    })
    return () => {
      cancelled = true
    }
  }, [focusedAppId])

  // Show the library whenever the last tile closes, so the shell is never left
  // staring at a workspace that is not there.
  useEffect(() => {
    if (openApps.length === 0) setDestination('apps')
  }, [openApps.length])

  // Land on the restored workspace rather than on the library.
  //
  // `destination` starts at 'apps' because that is right for a first launch, and
  // whether it is right for *this* launch is not known until the persisted set
  // has been read. Keyed on the restore finishing, so it fires once and never
  // pulls the user off a page they navigated to themselves.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (isRestoring || restoredRef.current) return
    restoredRef.current = true
    if (focusedApp) setDestination(null)
  }, [isRestoring, focusedApp])

  // Listen for session change events from main process
  useEffect(() => {
    window.electronAPI.onChatSessionChanged((sessionId) => {
      setActiveSessionId(sessionId)
    })
    return () => {
      window.electronAPI.offChatSessionChanged()
    }
  }, [])

  const handleModeChange = useCallback(async (mode: PermissionMode) => {
    const newMode = await window.electronAPI.setPermissionMode(mode)
    setPermissionMode(newMode)
  }, [])

  const handleAppSelect = useCallback(
    (app: SubApp) => {
      openApp(app)
      setDestination(null)
    },
    [openApp]
  )

  const handleFocusApp = useCallback(
    (appId: string) => {
      focusApp(appId)
      setDestination(null)
    },
    [focusApp]
  )

  const handleCloseFocusedApp = useCallback(() => {
    if (focusedApp) closeApp(focusedApp.id)
  }, [closeApp, focusedApp])

  const refreshActiveApp = useCallback(
    async (appId: string) => {
      const updated = await window.electronAPI.getApp(appId)
      if (updated) replaceApp(updated)
    },
    [replaceApp]
  )

  const handleVersionRollback = useCallback(
    async (commitId: string) => {
      if (!focusedApp) return
      await window.electronAPI.rollback(commitId, focusedApp.path)
      await refreshActiveApp(focusedApp.id)
    },
    [focusedApp, refreshActiveApp]
  )

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      if (!focusedApp) return
      await window.electronAPI.switchBranch(branchName, focusedApp.path)
      await refreshActiveApp(focusedApp.id)
    },
    [focusedApp, refreshActiveApp]
  )

  const handleBranchCreate = useCallback(
    async (name: string) => {
      if (!focusedApp) return
      await window.electronAPI.createBranch(name, focusedApp.path)
      await refreshActiveApp(focusedApp.id)
    },
    [focusedApp, refreshActiveApp]
  )

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    setDestination(null)
    await window.electronAPI.setActiveChatSession(sessionId)
  }, [])

  const handleSessionCreate = useCallback(async () => {
    setDestination(null)
    await window.electronAPI.createChatSession()
    // Session list and active session updated via IPC events
  }, [])

  const handleGoToApps = useCallback(() => setDestination('apps'), [])

  return (
    <RunningAppsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-ground text-bone">
        <AppShellHeader app={focusedApp} permissionMode={permissionMode} />

        <div className="flex min-h-0 flex-1">
          <NavRail
            destination={destination}
            onNavigate={setDestination}
            openApps={openApps}
            focusedAppId={focusedAppId}
            /* Phase 6 fills this from per-app turn state; until then no tile is busy. */
            busyAppIds={EMPTY_BUSY}
            onFocusApp={handleFocusApp}
            onCloseApp={closeApp}
          />

          {/*
              `overflow-clip`, not `overflow-hidden`: a hidden box is still a
              scroll container and can be scrolled programmatically, which is
              exactly how a panel's `scrollIntoView` once pushed this whole
              region off-screen. Clip cannot scroll at all. The shell's regions
              never scroll — panels scroll inside themselves.
            */}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-clip">
            {/*
              The workspace is mounted for as long as an app is focused, even
              while a destination covers it. Swapping it out instead would
              destroy the Preview panel's `<webview>` and drop whatever the
              transcript had in flight — which is the bug the dock was built to
              fix, so reintroducing it here would undo the whole thing.
            */}
            {focusedApp && syncedAppId === focusedApp.id ? (
              <Workspace
                key={focusedApp.id}
                app={focusedApp}
                permissionMode={permissionMode}
                activeSessionId={activeSessionId}
                onModeChange={handleModeChange}
                onSessionSelect={handleSessionSelect}
                onSessionCreate={handleSessionCreate}
                onRollback={handleVersionRollback}
                onBranchSwitch={handleBranchSwitch}
                onBranchCreate={handleBranchCreate}
                onCloseApp={handleCloseFocusedApp}
              />
            ) : (
              // Only when there is genuinely no app. While one is focused but not
              // yet acknowledged, this renders nothing rather than flashing an
              // empty state at an app that is about to appear.
              destination === null && !focusedApp && <NoAppSelected onGoToApps={handleGoToApps} />
            )}

            {destination !== null && (
              <div className="absolute inset-0 z-10 overflow-hidden bg-ground">
                {destination === 'apps' && (
                  <AppListing
                    onAppSelect={handleAppSelect}
                    activeAppId={focusedAppId}
                    openAppIds={openApps.map((app) => app.id)}
                  />
                )}
                {destination === 'help' && <Help />}
                {destination === 'settings' && (
                  <Settings permissionMode={permissionMode} onModeChange={handleModeChange} />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </RunningAppsProvider>
  )
}

/**
 * A stable empty list for the rail's busy set.
 *
 * A fresh `[]` each render would give `NavRail` a new prop every time and
 * re-render every tile; this is the placeholder until Phase 6 supplies real
 * per-app turn state.
 */
const EMPTY_BUSY: readonly string[] = []
