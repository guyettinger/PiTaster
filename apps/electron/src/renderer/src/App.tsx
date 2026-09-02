import { useState, useEffect, useCallback } from 'react'
import { Workspace } from './components/workspace/Workspace'
import { SkillsPanel } from './components/skills/SkillsPanel'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { AppListing } from './components/AppListing'
import { NoAppSelected } from './components/NoAppSelected'
import { AppShellHeader } from './components/shell/AppShellHeader'
import { NavRail } from './components/shell/NavRail'
import { RunningAppsProvider } from './context/RunningAppsContext'
import type { Destination } from './types/navigation'
import type { PermissionMode } from './types/electron'
import type { SubApp } from '@anyapp/core'

/**
 * Root application component.
 *
 * Owns the shell's fixed chrome — the draggable header and the global nav rail —
 * and the state the focused app's workspace is built from. The workspace itself
 * is a dock; where its panels sit is the dock's business, and is remembered per
 * app rather than held here.
 */
export function App() {
  // Navigation
  const [destination, setDestination] = useState<Destination>('apps')

  // Agent + app state
  const [activeApp, setActiveApp] = useState<SubApp | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Load initial permission mode
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
  }, [])

  // Restore active app on mount
  useEffect(() => {
    window.electronAPI.getActiveAppDetails().then((app) => {
      if (app) {
        setActiveApp(app)
        setDestination('workspace')
      }
    })
  }, [])

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

  const handleAppSelect = useCallback(async (app: SubApp) => {
    setActiveApp(app)
    setActiveSessionId(null) // Will be set by IPC event from apps:set-active
    await window.electronAPI.setActiveApp(app.id)
    setDestination('workspace')
  }, [])

  const handleCloseApp = useCallback(async () => {
    setActiveApp(null)
    setActiveSessionId(null)
    await window.electronAPI.setActiveApp(null)
    setDestination('apps')
  }, [])

  const refreshActiveApp = useCallback(async (appId: string) => {
    const updated = await window.electronAPI.getApp(appId)
    if (updated) setActiveApp(updated)
  }, [])

  const handleVersionRollback = useCallback(
    async (commitId: string) => {
      if (!activeApp) return
      await window.electronAPI.rollback(commitId, activeApp.path)
      await refreshActiveApp(activeApp.id)
    },
    [activeApp, refreshActiveApp]
  )

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      if (!activeApp) return
      await window.electronAPI.switchBranch(branchName, activeApp.path)
      await refreshActiveApp(activeApp.id)
    },
    [activeApp, refreshActiveApp]
  )

  const handleBranchCreate = useCallback(
    async (name: string) => {
      if (!activeApp) return
      await window.electronAPI.createBranch(name, activeApp.path)
      await refreshActiveApp(activeApp.id)
    },
    [activeApp, refreshActiveApp]
  )

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    setDestination('workspace')
    await window.electronAPI.setActiveChatSession(sessionId)
  }, [])

  const handleSessionCreate = useCallback(async () => {
    setDestination('workspace')
    await window.electronAPI.createChatSession()
    // Session list and active session updated via IPC events
  }, [])

  const handleOpenSkills = useCallback(() => setDestination('skills'), [])
  const handleGoToApps = useCallback(() => setDestination('apps'), [])

  return (
    <RunningAppsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-ground text-bone">
        <AppShellHeader app={activeApp} permissionMode={permissionMode} />

        <div className="flex min-h-0 flex-1">
          <NavRail destination={destination} onNavigate={setDestination} />

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
            {activeApp ? (
              <Workspace
                key={activeApp.id}
                app={activeApp}
                permissionMode={permissionMode}
                activeSessionId={activeSessionId}
                onModeChange={handleModeChange}
                onSessionSelect={handleSessionSelect}
                onSessionCreate={handleSessionCreate}
                onRollback={handleVersionRollback}
                onBranchSwitch={handleBranchSwitch}
                onBranchCreate={handleBranchCreate}
                onOpenSkills={handleOpenSkills}
                onCloseApp={handleCloseApp}
              />
            ) : (
              destination === 'workspace' && <NoAppSelected onGoToApps={handleGoToApps} />
            )}

            {destination !== 'workspace' && (
              <div className="absolute inset-0 z-10 overflow-hidden bg-ground">
                {destination === 'apps' && (
                  <AppListing
                    onAppSelect={handleAppSelect}
                    activeAppId={activeApp?.id ?? null}
                  />
                )}
                {destination === 'skills' && <SkillsPanel appName={activeApp?.name ?? null} />}
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
