import { useState, useEffect, useCallback, useRef } from 'react'
import { MountedWorkspace } from './components/workspace/MountedWorkspace'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { AppListing } from './components/AppListing'
import { NoAppSelected } from './components/NoAppSelected'
import { AppShellHeader } from './components/shell/AppShellHeader'
import { NavRail } from './components/shell/NavRail'
import { RunningAppsProvider } from './context/RunningAppsContext'
import { useOpenApps } from './hooks/useOpenApps'
import { forgetActivity, useBusyAppIds } from './state/agentActivity'
import type { Destination } from './types/navigation'
import type { PermissionMode } from './types/electron'
import type { SubApp } from '@pitaster/core'

/**
 * Root application component.
 *
 * Owns the shell's fixed chrome — the draggable header and the global nav rail — and
 * the per-app state the workspaces report back. The workspaces themselves are docks;
 * where their panels sit is each dock's business, and is remembered per app rather
 * than held here.
 *
 * Navigation is two-valued rather than one. `destination` names a page drawn *over*
 * the workspaces, and `null` means nothing covers them — so focusing an app is not
 * navigation at all, which is why the rail no longer has a Workspace item.
 *
 * **Every open app is mounted, not just the focused one.** That is what lets a
 * background app's turn keep filling in its own transcript, keeps its Preview
 * `<webview>` alive and its Monaco undo stack intact, and it is the renderer half of
 * the concurrency main gained in Phase 5. `MountedWorkspace` carries the reasoning
 * about how a background one is hidden.
 */
export function App() {
  // Which page, if any, covers the workspaces. `null` shows the focused app.
  const [destination, setDestination] = useState<Destination | null>('apps')

  const { openApps, focusedApp, isRestoring, openApp, focusApp, closeApp, replaceApp } =
    useOpenApps()

  /*
    Per app rather than per shell, because both are per app in main.

    The permission mode is read at every tool call, so one shared value meant a mode
    chosen for one app widened what another app's in-flight turn could do. The active
    session is per conversation by definition. Both are *reported up* by each mounted
    workspace instead of being owned there, because the shell needs the focused app's
    copy: the header shows the mode and Settings changes it.
  */
  const [modes, setModes] = useState<Record<string, PermissionMode>>({})
  const [sessions, setSessions] = useState<Record<string, string | null>>({})

  // Stable, so the callbacks a workspace memoizes on them stay stable too — the
  // whole reason `MountedWorkspace` exists rather than this being inlined.
  const handleModeResolved = useCallback((appId: string, mode: PermissionMode) => {
    setModes((current) => (current[appId] === mode ? current : { ...current, [appId]: mode }))
  }, [])

  const handleSessionResolved = useCallback((appId: string, sessionId: string | null) => {
    setSessions((current) =>
      current[appId] === sessionId ? current : { ...current, [appId]: sessionId }
    )
  }, [])

  const focusedAppId = focusedApp?.id ?? null
  const permissionMode = (focusedAppId && modes[focusedAppId]) || 'default'

  // Tell main which app is focused.
  //
  // Focus decides nothing a channel acts on — every one of them names its app — and
  // it no longer brings the workspace up either; each workspace does that for itself
  // on mount. What is left is the window's own answer to "which one am I showing",
  // which main persists so the next launch opens on it.
  useEffect(() => {
    void window.electronAPI.setActiveApp(focusedAppId)
  }, [focusedAppId])

  // Show the library whenever the last tile closes, so the shell is never left
  // staring at a workspace that is not there.
  useEffect(() => {
    if (openApps.length === 0) setDestination('apps')
  }, [openApps.length])

  // Land on the restored workspace rather than on the library.
  //
  // `destination` starts at 'apps' because that is right for a first launch, and
  // whether it is right for *this* launch is not known until the persisted set has
  // been read. Keyed on the restore finishing, so it fires once and never pulls the
  // user off a page they navigated to themselves.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (isRestoring || restoredRef.current) return
    restoredRef.current = true
    if (focusedApp) setDestination(null)
  }, [isRestoring, focusedApp])

  const handleModeChange = useCallback(
    async (mode: PermissionMode) => {
      if (!focusedAppId) return
      const applied = await window.electronAPI.setPermissionMode(mode, focusedAppId)
      handleModeResolved(focusedAppId, applied)
    },
    [focusedAppId, handleModeResolved]
  )

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

  // A closed tile takes its activity reading with it. Without this the rail's busy
  // set is derived from a key list that only ever grows, and a deleted app would sit
  // in it for the life of the session.
  const handleCloseApp = useCallback(
    (appId: string) => {
      closeApp(appId)
      forgetActivity(appId)
    },
    [closeApp]
  )

  const handleAppChanged = useCallback(
    async (appId: string) => {
      const updated = await window.electronAPI.getApp(appId)
      if (updated) replaceApp(updated)
    },
    [replaceApp]
  )

  const handleGoToApps = useCallback(() => setDestination('apps'), [])

  // Fed from the same store the composer's own gauges read, so a tile cannot claim
  // an app is working while that app's composer says it is idle.
  const busyAppIds = useBusyAppIds()

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
            busyAppIds={busyAppIds}
            onFocusApp={handleFocusApp}
            onCloseApp={handleCloseApp}
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
              Every open app, stacked. They are all absolutely positioned and only
              the focused one is visible; see `MountedWorkspace` for why it is not
              hidden with `display` or `visibility`. Keyed by app id so React never
              reuses one app's dock for another's.

              They also stay mounted while a destination covers them — swapping them
              out would destroy the Preview panel's `<webview>` and drop whatever a
              transcript had in flight, which is the bug the dock was built to fix.
            */}
            {openApps.map((app) => (
              <MountedWorkspace
                key={app.id}
                app={app}
                focused={app.id === focusedAppId}
                permissionMode={modes[app.id] ?? 'default'}
                activeSessionId={sessions[app.id] ?? null}
                onModeResolved={handleModeResolved}
                onSessionResolved={handleSessionResolved}
                onCloseApp={handleCloseApp}
                onAppChanged={handleAppChanged}
              />
            ))}

            {destination === null && !focusedApp && <NoAppSelected onGoToApps={handleGoToApps} />}

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
