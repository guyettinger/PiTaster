# Session 6.6: Integration

## Overview

This sub-session integrates all sub-app components into the main application, updating the navigation and layout.

**Estimated scope**: Small  
**Prerequisites**: Session 6.5 complete  
**Deliverable**: Fully integrated sub-apps with working UI flow

## Objectives

1. Update main App.tsx with app management
2. Update Chat to require active app
3. Update VersionControl to use app path
4. Final testing and polish

---

## Task 1: Update Main App Layout

### Update apps/electron/src/renderer/src/App.tsx

```tsx
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

interface Skill {
  name: string
  description: string
  content: string
  filepath: string
}

type MainPanel = 'apps' | 'chat' | 'settings' | 'help'
type RightPanel = 'versions' | 'skills' | 'sources' | null

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
    const mention = `@${skill.name} `
    setChatInput(prev => prev.endsWith(' ') || !prev ? prev + mention : prev + ' ' + mention)
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
            badge={activeApp ? '' : undefined}
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
```

---

## Task 2: Update VersionControl Component

### Update apps/electron/src/renderer/src/components/VersionControl.tsx

Add `appPath` prop and use it for IPC calls:

```tsx
interface VersionControlProps {
  isVisible: boolean
  appPath: string  // Required now
  onRollback: (commitId: string) => void
  onBranchSwitch: (branchName: string) => void
  onBranchCreate: (name: string) => void
}

export function VersionControl({ 
  isVisible, 
  appPath,
  onRollback, 
  onBranchSwitch, 
  onBranchCreate 
}: VersionControlProps) {
  // ... existing state ...

  const loadVersionData = useCallback(async () => {
    if (!isVisible || !appPath) return
    
    setIsLoading(true)
    try {
      const [stateResult, branchesResult, historyResult] = await Promise.all([
        window.electronAPI.getVersionState(appPath),
        window.electronAPI.getBranches(appPath),
        window.electronAPI.getHistory(appPath, 20)
      ])
      
      setState(stateResult)
      setBranches(branchesResult)
      setHistory(historyResult)
    } catch (err) {
      console.error('Failed to load version data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [isVisible, appPath])

  useEffect(() => {
    loadVersionData()
  }, [loadVersionData])

  // ... rest of component using loadVersionData for refresh ...
}
```

---

## Task 3: Update Chat Component

### Update apps/electron/src/renderer/src/components/Chat.tsx

Ensure chat works with app context:

```tsx
// Update the placeholder text
const placeholder = 'Ask about your app... (use @skill-name to activate skills)'

// The chat should work normally - the agent receives context via system prompt
// No changes needed to Chat internals, just ensure it's only rendered when app is active
```

---

## Task 4: Final Testing Checklist

### User Flow Tests

1. **App Creation Flow**
   - [ ] Open app → See Apps panel
   - [ ] Click "New App" → See create form
   - [ ] Fill in name, select template → Create works
   - [ ] Auto-navigates to Chat with new app

2. **App Selection Flow**
   - [ ] Click existing app → Switches to Chat
   - [ ] App header shows name and branch
   - [ ] Back button returns to Apps list

3. **Chat with App Context**
   - [ ] Send message → Agent responds with app awareness
   - [ ] Agent can list files in app
   - [ ] Agent can read files
   - [ ] Agent can write files (commits work)
   - [ ] Agent cannot access files outside app

4. **Version Control**
   - [ ] Version panel shows app's branches
   - [ ] Version panel shows app's history
   - [ ] Creating branch works
   - [ ] Switching branch works
   - [ ] Rollback works

5. **No App Selected States**
   - [ ] Chat shows "No app selected" message
   - [ ] Right panel buttons are disabled
   - [ ] "Go to Apps" button works

6. **App Deletion**
   - [ ] Delete shows confirmation
   - [ ] Delete removes app from list
   - [ ] If active app deleted, returns to Apps

---

## Verification Checklist

- [ ] App navigation works (Apps → Chat → Apps)
- [ ] Active app persists across navigation
- [ ] Right panels only show when app active
- [ ] Version control uses correct app path
- [ ] Chat requires app selection
- [ ] All templates create valid apps
- [ ] Git operations work per-app
- [ ] No console errors
- [ ] `bun run typecheck:all` passes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.6): integrate sub-apps into main application

- Update App.tsx with app management navigation
- Add app-aware version control
- Disable right panels when no app selected
- Show NoAppSelected state in chat
- Wire up all app lifecycle events"
```

---

## Session 6 Complete

All sub-sessions complete. The sub-apps architecture is now fully integrated:

- ✅ 6.1: Types and AppManager base
- ✅ 6.2: App templates
- ✅ 6.3: App listing UI
- ✅ 6.4: IPC integration
- ✅ 6.5: Agent scoping
- ✅ 6.6: Integration

## Final Commit

```bash
git add -A
git commit -m "feat: complete sub-apps architecture (Session 6)

Session 6 implements sandboxed self-modification:
- Outer Electron container is immutable
- Sub-apps in ~/.anyapp/apps/ are fully modifiable
- Each app has isolated git versioning
- Agent tools scoped to active app only
- Path traversal prevention for security
- 5 app templates available

Sub-sessions:
- 6.1: Type definitions and AppManager
- 6.2: App templates (React, Node CLI, Server, Static, Blank)
- 6.3: App listing UI components
- 6.4: IPC handlers and preload API
- 6.5: Agent scoping and security
- 6.6: Main app integration"
```
