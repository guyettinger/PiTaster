import { useState, useEffect, useCallback, useRef } from 'react'
import { Chat } from './components/Chat'
import { VersionControl } from './components/VersionControl'
import { SourcesPanel } from './components/SourcesPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { Settings } from './components/Settings'
import type { PermissionMode } from './types/electron'

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
type MainPanel = 'chat' | 'settings'
type RightPanel = 'versions' | 'skills' | 'sources' | null

/**
 * Navigation button component.
 */
function NavButton({ 
  icon, 
  label,
  active, 
  onClick 
}: { 
  icon: string
  label: string
  active: boolean
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded text-lg transition-colors ${
        active 
          ? 'bg-neutral-700 text-neutral-50' 
          : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
      }`}
    >
      {icon}
    </button>
  )
}

/**
 * Root application component with sidebar navigation.
 */
export function App() {
  const [mainPanel, setMainPanel] = useState<MainPanel>('chat')
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [chatInput, setChatInput] = useState('')
  const chatInputRef = useRef<HTMLInputElement>(null)

  // Get initial permission mode
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
  }, [])

  const handleModeChange = useCallback(async (mode: PermissionMode) => {
    const newMode = await window.electronAPI.setPermissionMode(mode)
    setPermissionMode(newMode)
  }, [])

  const handleVersionRollback = useCallback((commitId: string) => {
    // Could show a notification or update chat
    console.log(`Rolled back to ${commitId}`)
  }, [])

  const handleBranchSwitch = useCallback((branchName: string) => {
    console.log(`Switched to ${branchName}`)
  }, [])

  const handleBranchCreate = useCallback((name: string) => {
    console.log(`Created branch ${name}`)
  }, [])

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
            icon="💬"
            label="Chat"
            active={mainPanel === 'chat'}
            onClick={() => setMainPanel('chat')}
          />
        </div>

        {/* Right Panel Toggles */}
        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-4">
          <NavButton
            icon="📜"
            label="Version Control"
            active={rightPanel === 'versions'}
            onClick={() => toggleRightPanel('versions')}
          />
          <NavButton
            icon="⚡"
            label="Skills"
            active={rightPanel === 'skills'}
            onClick={() => toggleRightPanel('skills')}
          />
          <NavButton
            icon="🔌"
            label="Sources"
            active={rightPanel === 'sources'}
            onClick={() => toggleRightPanel('sources')}
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
      <main className="flex flex-1 overflow-hidden">
        {/* Main Panel */}
        <div className="flex-1">
          {mainPanel === 'chat' && (
            <Chat
              permissionMode={permissionMode}
              onModeChange={handleModeChange}
              inputRef={chatInputRef}
              externalInput={chatInput}
              onExternalInputChange={setChatInput}
            />
          )}
          {mainPanel === 'settings' && <Settings />}
        </div>

        {/* Right Panel */}
        {rightPanel && (
          <div className="w-80 border-l border-neutral-800">
            {rightPanel === 'versions' && (
              <VersionControl
                isVisible={true}
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
      </main>
    </div>
  )
}

export default App
