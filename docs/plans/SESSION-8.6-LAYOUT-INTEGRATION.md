# Session 8.6: Layout Integration

## Overview

This sub-session integrates the terminal and preview panels into the main App.tsx layout with navigation and resizable panels.

**Estimated scope**: Small  
**Prerequisites**: Session 8.5 complete  
**Deliverable**: Complete integrated layout with bottom panels

## Objectives

1. Add bottom panel state and navigation
2. Integrate TerminalPanel and PreviewPanel
3. Add panel toggle buttons to sidebar

---

## Task 1: Update App.tsx Layout

### Update apps/electron/src/renderer/src/App.tsx

Add imports:

```typescript
import { TerminalPanel } from './components/TerminalPanel'
import { PreviewPanel } from './components/PreviewPanel'
```

Add bottom panel state after the existing panel states:

```typescript
type BottomPanel = 'terminal' | 'preview' | null
const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
const [bottomPanelHeight, setBottomPanelHeight] = useState(300)
```

Add toggle function:

```typescript
const toggleBottomPanel = useCallback((panel: BottomPanel) => {
  setBottomPanel(prev => prev === panel ? null : panel)
}, [])
```

Update the navigation section to add Terminal and Preview buttons. In the "Right Panel Toggles" section, add these after the Sources button:

```typescript
        {/* Bottom Panel Toggles */}
        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-4">
          <NavButton
            icon="💻"
            label="Terminal"
            active={bottomPanel === 'terminal'}
            onClick={() => toggleBottomPanel('terminal')}
            disabled={!activeApp}
          />
          <NavButton
            icon="👁️"
            label="Preview"
            active={bottomPanel === 'preview'}
            onClick={() => toggleBottomPanel('preview')}
            disabled={!activeApp}
          />
        </div>
```

Update the main content area to include the bottom panel. Replace the content area structure with:

```typescript
      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* App Header - shown when app is active and in chat */}
        {activeApp && mainPanel === 'chat' && (
          <AppHeader app={activeApp} onBack={handleBackToApps} />
        )}

        {/* Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Main + Right Panel Row */}
          <div className="flex flex-1 overflow-hidden" style={{
            height: activeApp && bottomPanel ? `calc(100% - ${bottomPanelHeight}px)` : '100%'
          }}>
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

          {/* Bottom Panel - Terminal or Preview */}
          {activeApp && bottomPanel && (
            <BottomPanelContainer
              height={bottomPanelHeight}
              onHeightChange={setBottomPanelHeight}
              onClose={() => setBottomPanel(null)}
            >
              {bottomPanel === 'terminal' && (
                <TerminalPanel appId={activeApp.id} isVisible={true} />
              )}
              {bottomPanel === 'preview' && (
                <PreviewPanel appId={activeApp.id} isVisible={true} />
              )}
            </BottomPanelContainer>
          )}
        </div>
      </main>
```

---

## Task 2: Bottom Panel Container Component

Add this component inside App.tsx (before the main App function) or create a separate file:

```typescript
/**
 * Props for BottomPanelContainer.
 */
interface BottomPanelContainerProps {
  height: number
  onHeightChange: (height: number) => void
  onClose: () => void
  children: React.ReactNode
}

/**
 * Resizable container for bottom panels.
 */
function BottomPanelContainer({ 
  height, 
  onHeightChange, 
  onClose, 
  children 
}: BottomPanelContainerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    startY.current = e.clientY
    startHeight.current = height
  }, [height])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY.current - e.clientY
      const newHeight = Math.min(Math.max(startHeight.current + delta, 150), 600)
      onHeightChange(newHeight)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onHeightChange])

  return (
    <div 
      className="flex flex-col border-t border-neutral-800"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`group flex h-1.5 cursor-ns-resize items-center justify-center hover:bg-blue-500/30 ${
          isDragging ? 'bg-blue-500/50' : ''
        }`}
      >
        <div className="h-0.5 w-12 rounded bg-neutral-700 group-hover:bg-blue-500" />
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
```

Don't forget to add the necessary imports and refs:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
```

---

## Task 3: Update Navigation Layout

Ensure the sidebar navigation groups are properly organized:

```typescript
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

        {/* Right Panel Toggles */}
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

        {/* Bottom Panel Toggles */}
        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-4">
          <NavButton
            icon="💻"
            label="Terminal"
            active={bottomPanel === 'terminal'}
            onClick={() => toggleBottomPanel('terminal')}
            disabled={!activeApp}
          />
          <NavButton
            icon="👁️"
            label="Preview"
            active={bottomPanel === 'preview'}
            onClick={() => toggleBottomPanel('preview')}
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
```

---

## Task 4: Clear Bottom Panel on App Change

Update the `handleBackToApps` function to also clear the bottom panel:

```typescript
const handleBackToApps = useCallback(async () => {
  setActiveApp(null)
  await window.electronAPI.setActiveApp(null)
  setMainPanel('apps')
  setRightPanel(null)
  setBottomPanel(null) // Add this line
}, [])
```

---

## Verification Checklist

- [ ] Bottom panel state added to App.tsx
- [ ] Navigation buttons for Terminal and Preview added
- [ ] `TerminalPanel` integrated and working
- [ ] `PreviewPanel` integrated and working
- [ ] Resize handle works for bottom panel
- [ ] Panels close when switching apps
- [ ] `bun run typecheck:all` passes
- [ ] Full workflow test: Create app → Run → See logs → See preview

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(8.6): integrate terminal and preview panels

- Add bottom panel state and toggle functions
- Create resizable BottomPanelContainer
- Add Terminal and Preview navigation buttons
- Integrate TerminalPanel and PreviewPanel
- Clear panels on app change
- Complete Session 8 implementation"
```

---

## End of Session 8

After completing all sub-sessions, verify the complete system:

1. **Create a react-vite app** and click Run
2. **Verify terminal** shows Vite startup logs
3. **Verify preview** loads the app at localhost:5200+
4. **Click Open in Browser** to launch externally
5. **Stop the app** and verify cleanup
6. **Run multiple apps** to test port allocation

## Final Session Commit

```bash
git add -A
git commit -m "feat: complete app preview system (Session 8)

- AppRunner manages dev server processes
- Dynamic port assignment (5200+ for Vite, 3100+ for servers)
- Terminal panel with ANSI color support
- Preview panel with embedded webview
- Run/stop controls in AppCard and AppHeader
- Open in browser functionality
- Running apps context for state management"
```
