import { useState, useEffect, useCallback } from 'react'
import { Chat } from './components/Chat'
import { VersionControl } from './components/VersionControl'
import { SkillsPanel } from './components/skills/SkillsPanel'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { AppListing } from './components/AppListing'
import { NoAppSelected } from './components/NoAppSelected'
import { TerminalPanel } from './components/TerminalPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { AppShellHeader } from './components/shell/AppShellHeader'
import { NavRail } from './components/shell/NavRail'
import { AppContextColumn } from './components/shell/AppContextColumn'
import { BottomPanelContainer } from './components/shell/BottomPanelContainer'
import { RunningAppsProvider } from './context/RunningAppsContext'
import type { MainPanel, RightPanel, BottomPanel } from './types/navigation'
import type { PermissionMode } from './types/electron'
import type { SubApp } from '@anyapp/core'

/**
 * Root application component.
 *
 * Owns the shell's three regions — the always-present draggable header, the
 * global nav rail, and the focused app's context column — plus the docked
 * panels that inspect the workspace.
 */
export function App() {
  // Navigation
  const [mainPanel, setMainPanel] = useState<MainPanel>('apps')
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(300)

  // Agent + app state
  const [activeApp, setActiveApp] = useState<SubApp | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Chat input state, so the skills panel can insert an @mention into it

  // Load initial permission mode
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
  }, [])

  // Restore active app on mount
  useEffect(() => {
    window.electronAPI.getActiveAppDetails().then((app) => {
      if (app) {
        setActiveApp(app)
        setMainPanel('chat')
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
    setMainPanel('chat')
  }, [])

  const handleCloseApp = useCallback(async () => {
    setActiveApp(null)
    setActiveSessionId(null)
    await window.electronAPI.setActiveApp(null)
    setMainPanel('apps')
    setRightPanel(null)
    setBottomPanel(null)
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
    setMainPanel('chat')
    await window.electronAPI.setActiveChatSession(sessionId)
  }, [])

  const handleSessionCreate = useCallback(async () => {
    setMainPanel('chat')
    await window.electronAPI.createChatSession()
    // Session list and active session updated via IPC events
  }, [])

  // A panel toggle always ends with that panel visible, so opening one from
  // Settings or Help returns you to the workspace it docks to.
  const toggleRightPanel = useCallback((panel: NonNullable<RightPanel>) => {
    setMainPanel('chat')
    setRightPanel((prev) => (prev === panel ? null : panel))
  }, [])

  const toggleBottomPanel = useCallback((panel: NonNullable<BottomPanel>) => {
    setMainPanel('chat')
    setBottomPanel((prev) => (prev === panel ? null : panel))
  }, [])

  const inWorkspace = mainPanel === 'chat'
  const showDockedPanels = inWorkspace && activeApp !== null

  return (
    <RunningAppsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-ground text-bone">
        <AppShellHeader app={activeApp} permissionMode={permissionMode} />

        <div className="flex min-h-0 flex-1">
          <NavRail panel={mainPanel} onNavigate={setMainPanel} />

          {activeApp && (
            <AppContextColumn
              app={activeApp}
              inWorkspace={inWorkspace}
              onOpenWorkspace={() => setMainPanel('chat')}
              onCloseApp={handleCloseApp}
              activeSessionId={activeSessionId}
              onSessionSelect={handleSessionSelect}
              onSessionCreate={handleSessionCreate}
              rightPanel={rightPanel}
              bottomPanel={bottomPanel}
              onToggleRightPanel={toggleRightPanel}
              onToggleBottomPanel={toggleBottomPanel}
            />
          )}

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1 overflow-hidden">
                {mainPanel === 'apps' && (
                  <AppListing
                    onAppSelect={handleAppSelect}
                    activeAppId={activeApp?.id ?? null}
                  />
                )}

                {mainPanel === 'chat' &&
                  (activeApp ? (
                    <Chat
                      app={activeApp}
                      permissionMode={permissionMode}
                      onModeChange={handleModeChange}
                      activeSessionId={activeSessionId}
                    />
                  ) : (
                    <NoAppSelected onGoToApps={() => setMainPanel('apps')} />
                  ))}

                {mainPanel === 'skills' && (
                  <SkillsPanel appName={activeApp?.name ?? null} />
                )}
                {mainPanel === 'help' && <Help />}
                {mainPanel === 'settings' && (
                  <Settings
                    permissionMode={permissionMode}
                    onModeChange={handleModeChange}
                  />
                )}
              </div>

              {showDockedPanels && rightPanel === 'versions' && (
                <div
                  className="w-72 max-w-[38%] shrink-0 overflow-hidden border-l border-line bg-panel"
                >
                  <VersionControl
                    appPath={activeApp.path}
                    onRollback={handleVersionRollback}
                    onBranchSwitch={handleBranchSwitch}
                    onBranchCreate={handleBranchCreate}
                  />
                </div>
              )}
            </div>

            {showDockedPanels && bottomPanel && (
              <BottomPanelContainer
                height={bottomPanelHeight}
                onHeightChange={setBottomPanelHeight}
              >
                {bottomPanel === 'terminal' && (
                  <TerminalPanel appId={activeApp.id} isVisible={true} />
                )}
                {bottomPanel === 'preview' && (
                  <PreviewPanel appId={activeApp.id} isVisible={true} />
                )}
              </BottomPanelContainer>
            )}
          </main>
        </div>
      </div>
    </RunningAppsProvider>
  )
}
