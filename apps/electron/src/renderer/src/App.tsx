import { useState, useEffect, useCallback, useRef } from 'react'
import { Chat } from './components/Chat'
import { VersionControl } from './components/VersionControl'
import { SourcesPanel } from './components/SourcesPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { AppListing } from './components/AppListing'
import { AppHeader } from './components/AppHeader'
import { NoAppSelected } from './components/NoAppSelected'
import type { PermissionMode } from './types/electron'
import type { SubApp } from '@anyapp/core'

/**
 * Skill definition for @mention insertion.
 */
interface Skill {
  name: string
  description: string
  content: string
  filepath: string
}

/**
 * Navigation panel types.
 */
type MainPanel = 'apps' | 'chat' | 'settings' | 'help'
type RightPanel = 'versions' | 'skills' | 'sources' | null

/**
 * Navigation button component.
 */
function NavButton({ 
  icon, 
  label,
  active, 
  onClick,
  badge,
  disabled
}: { 
  icon: string
  label: string
  active: boolean
  onClick: () => void
  badge?: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`relative flex h-10 w-10 items-center justify-center rounded text-lg transition-colors ${
        disabled
          ? 'cursor-not-allowed text-neutral-600'
          : active 
            ? 'bg-neutral-700 text-neutral-50' 
            : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
      }`}
    >
      {icon}
      {badge && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

/**
 * Root application component with sidebar navigation.
 */
export function App() {
  // Panel state
  const [mainPanel, setMainPanel] = useState<MainPanel>('apps')
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  
  // App state
  const [activeApp, setActiveApp] = useState<SubApp | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  
  // Chat input state (for skill insertion)
  const [chatInput, setChatInput] = useState('')
  const chatInputRef = useRef<HTMLInputElement>(null)

  // Load initial permission mode
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
  }, [])

  // Restore active app on mount
  useEffect(() => {
    window.electronAPI.getActiveAppDetails().then(app => {
      if (app) {
        setActiveApp(app)
      }
    })
  }, [])

  const handleModeChange = useCallback(async (mode: PermissionMode) => {
    const newMode = await window.electronAPI.setPermissionMode(mode)
    setPermissionMode(newMode)
  }, [])

  const handleAppSelect = useCallback(async (app: SubApp) => {
    setActiveApp(app)
    await window.electronAPI.setActiveApp(app.id)
    setMainPanel('chat')
  }, [])

  const handleBackToApps = useCallback(async () => {
    setActiveApp(null)
    await window.electronAPI.setActiveApp(null)
    setMainPanel('apps')
    setRightPanel(null)
  }, [])

  const handleVersionRollback = useCallback(async (commitId: string) => {
    if (!activeApp) return
    await window.electronAPI.rollback(commitId, activeApp.path)
    // Refresh app state
    const updated = await window.electronAPI.getApp(activeApp.id)
    if (updated) setActiveApp(updated)
  }, [activeApp])

  const handleBranchSwitch = useCallback(async (branchName: string) => {
    if (!activeApp) return
    await window.electronAPI.switchBranch(branchName, activeApp.path)
    const updated = await window.electronAPI.getApp(activeApp.id)
    if (updated) setActiveApp(updated)
  }, [activeApp])

  const handleBranchCreate = useCallback(async (name: string) => {
    if (!activeApp) return
    await window.electronAPI.createBranch(name, activeApp.path)
    const updated = await window.electronAPI.getApp(activeApp.id)
    if (updated) setActiveApp(updated)
  }, [activeApp])

  const handleSkillSelect = useCallback((skill: Skill) => {
    // Insert @mention at cursor position or end of input
    const mention = `@${skill.name} `
    setChatInput(prev => {
      if (!prev || prev.endsWith(' ')) {
        return prev + mention
      }
      return prev + ' ' + mention
    })
    // Focus the input and switch to chat
    setMainPanel('chat')
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [])

  const toggleRightPanel = useCallback((panel: RightPanel) => {
    setRightPanel(prev => prev === panel ? null : panel)
  }, [])

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-50">
      {/* Sidebar Navigation */}
      <nav className="flex w-14 flex-col items-center border-r border-neutral-800 bg-neutral-900 py-3">
        {/* Main Navigation */}
        <div className="flex flex-col gap-1">
          <NavButton
            icon="📱"
            label="Apps"
            active={mainPanel === 'apps'}
            onClick={() => setMainPanel('apps')}
          />
          <NavButton
            icon="💬"
            label="Chat"
            active={mainPanel === 'chat'}
            onClick={() => setMainPanel('chat')}
          />
          <NavButton
            icon="📚"
            label="Help"
            active={mainPanel === 'help'}
            onClick={() => setMainPanel('help')}
          />
        </div>

        {/* Right Panel Toggles - Only enabled when app is active */}
        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-4">
          <NavButton
            icon="📜"
            label="Version Control"
            active={rightPanel === 'versions'}
            onClick={() => toggleRightPanel('versions')}
            disabled={!activeApp}
          />
          <NavButton
            icon="⚡"
            label="Skills"
            active={rightPanel === 'skills'}
            onClick={() => toggleRightPanel('skills')}
            disabled={!activeApp}
          />
          <NavButton
            icon="🔌"
            label="Sources"
            active={rightPanel === 'sources'}
            onClick={() => toggleRightPanel('sources')}
            disabled={!activeApp}
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <div className="flex flex-col gap-1 border-t border-neutral-800 pt-3">
          <NavButton
            icon="⚙️"
            label="Settings"
            active={mainPanel === 'settings'}
            onClick={() => setMainPanel('settings')}
          />
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* App Header - shown when app is active and in chat */}
        {activeApp && mainPanel === 'chat' && (
          <AppHeader app={activeApp} onBack={handleBackToApps} />
        )}

        {/* Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main Panel */}
          <div className="flex-1 overflow-hidden">
            {mainPanel === 'apps' && (
              <AppListing
                onAppSelect={handleAppSelect}
                activeAppId={activeApp?.id ?? null}
              />
            )}
            
            {mainPanel === 'chat' && (
              activeApp ? (
                <Chat
                  permissionMode={permissionMode}
                  onModeChange={handleModeChange}
                  inputRef={chatInputRef}
                  externalInput={chatInput}
                  onExternalInputChange={setChatInput}
                />
              ) : (
                <NoAppSelected onGoToApps={() => setMainPanel('apps')} />
              )
            )}
            
            {mainPanel === 'help' && <Help />}
            {mainPanel === 'settings' && <Settings />}
          </div>

          {/* Right Panel - only shown when app is active */}
          {activeApp && rightPanel && (
            <div className="w-80 overflow-hidden border-l border-neutral-800">
              {rightPanel === 'versions' && (
                <VersionControl
                  isVisible={true}
                  appPath={activeApp.path}
                  onRollback={handleVersionRollback}
                  onBranchSwitch={handleBranchSwitch}
                  onBranchCreate={handleBranchCreate}
                />
              )}
              {rightPanel === 'skills' && (
                <SkillsPanel
                  isVisible={true}
                  onSkillSelect={handleSkillSelect}
                />
              )}
              {rightPanel === 'sources' && (
                <SourcesPanel isVisible={true} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App