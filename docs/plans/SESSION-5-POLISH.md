# Session 5: Polish + Integration

## Overview

This session completes the application with final integration, improved chat UI, remaining skills, and overall polish.

**Estimated scope**: Medium  
**Prerequisites**: Session 4 complete (sources and skills working)  
**Deliverable**: Complete, polished self-modifying Electron app

## Objectives

1. Enhance chat UI with tool visualization
2. Add tool approval dialog
3. Integrate skills into agent queries
4. Create remaining skills
5. Add settings/preferences UI
6. Final testing and bug fixes

## Tasks

This session is primarily sequential integration work.

---

## Part 1: Enhanced Chat UI

### apps/electron/src/renderer/src/components/Chat.tsx

Complete chat interface with tool visualization:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import type { StreamChunk, PermissionMode, ToolApprovalRequest, Skill } from '@pitaster/core'
import { ToolApprovalDialog } from './ToolApprovalDialog'
import { MessageBubble } from './MessageBubble'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: { name: string; status: 'running' | 'complete' }[]
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    window.electronAPI.getPermissionMode().then(setPermissionMode)
    
    window.electronAPI.onAgentStream((chunk: StreamChunk) => {
      handleStreamChunk(chunk)
    })
    
    window.electronAPI.onToolApproval((request: ToolApprovalRequest) => {
      setPendingApproval(request)
    })
  }, [])
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  const handleStreamChunk = (chunk: StreamChunk) => {
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'assistant') return prev
      
      switch (chunk.type) {
        case 'text':
          return [...prev.slice(0, -1), { 
            ...last, 
            content: last.content + (chunk.text ?? '') 
          }]
        
        case 'tool_start':
          return [...prev.slice(0, -1), {
            ...last,
            tools: [...(last.tools ?? []), { name: chunk.tool!, status: 'running' as const }]
          }]
        
        case 'tool_end':
          const tools = last.tools ?? []
          const runningIdx = tools.findIndex(t => t.status === 'running')
          if (runningIdx >= 0) {
            const newTools = [...tools]
            newTools[runningIdx] = { ...newTools[runningIdx], status: 'complete' as const }
            return [...prev.slice(0, -1), { ...last, tools: newTools }]
          }
          return prev
        
        case 'complete':
          setIsStreaming(false)
          return prev
        
        case 'error':
          setIsStreaming(false)
          return [...prev.slice(0, -1), {
            ...last,
            content: last.content + `\n\n**Error:** ${chunk.error}`
          }]
        
        default:
          return prev
      }
    })
  }
  
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return
    
    // Extract @mentions for skills
    const mentions = input.match(/@([a-z0-9-]+)/g) ?? []
    const skillNames = mentions.map(m => m.slice(1))
    setActiveSkills(skillNames)
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input
    }
    
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      tools: []
    }
    
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)
    
    await window.electronAPI.sendMessage(input)
  }, [input, isStreaming])
  
  const handleApproval = (approved: boolean) => {
    if (pendingApproval) {
      window.electronAPI.respondToolApproval({
        id: pendingApproval.id,
        approved
      })
      setPendingApproval(null)
    }
  }
  
  const handleModeChange = async (mode: PermissionMode) => {
    await window.electronAPI.setPermissionMode(mode)
    setPermissionMode(mode)
  }
  
  const insertSkillMention = (skill: Skill) => {
    setInput(prev => prev + `@${skill.name} `)
  }
  
  return (
    <div className="flex flex-col h-screen bg-neutral-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <h1 className="text-lg font-semibold">Pi Taster</h1>
        <div className="flex items-center gap-4">
          <select 
            value={permissionMode}
            onChange={(e) => handleModeChange(e.target.value as PermissionMode)}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="plan">Explore</option>
            <option value="default">Ask to Edit</option>
            <option value="acceptEdits">Auto Edit</option>
            <option value="bypassPermissions">Auto All</option>
          </select>
        </div>
      </header>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      
      {/* Active Skills Indicator */}
      {activeSkills.length > 0 && isStreaming && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
          <span className="text-sm text-blue-700">
            Using skills: {activeSkills.map(s => `@${s}`).join(', ')}
          </span>
        </div>
      )}
      
      {/* Input */}
      <div className="p-4 border-t bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Ask the agent... (use @skill-name to activate skills)"
              disabled={isStreaming}
              className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={sendMessage}
              disabled={isStreaming || !input.trim()}
              className="px-5 py-2.5 bg-blue-500 text-white rounded-lg disabled:opacity-50 hover:bg-blue-600 transition-colors"
            >
              {isStreaming ? 'Thinking...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Tool Approval Dialog */}
      {pendingApproval && (
        <ToolApprovalDialog
          request={pendingApproval}
          onApprove={() => handleApproval(true)}
          onDeny={() => handleApproval(false)}
        />
      )}
    </div>
  )
}
```

### apps/electron/src/renderer/src/components/MessageBubble.tsx

```tsx
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: { name: string; status: 'running' | 'complete' }[]
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`max-w-[80%] rounded-lg ${
          isUser 
            ? 'bg-blue-500 text-white px-4 py-2.5' 
            : 'bg-white border px-4 py-3 shadow-sm'
        }`}
      >
        {/* Tool indicators */}
        {message.tools && message.tools.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.tools.map((tool, i) => (
              <div 
                key={i}
                className={`text-xs px-2 py-1 rounded ${
                  tool.status === 'running'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {tool.status === 'running' ? '⏳' : '✓'} {tool.name}
              </div>
            ))}
          </div>
        )}
        
        {/* Content */}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}
```

### apps/electron/src/renderer/src/components/ToolApprovalDialog.tsx

```tsx
import type { ToolApprovalRequest } from '@pitaster/core'

interface Props {
  request: ToolApprovalRequest
  onApprove: () => void
  onDeny: () => void
}

export function ToolApprovalDialog({ request, onApprove, onDeny }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Tool Approval Required</h2>
        </div>
        
        <div className="p-4">
          <p className="text-sm text-neutral-600 mb-3">
            The agent wants to use:
          </p>
          
          <div className="bg-neutral-50 rounded p-3 mb-4">
            <div className="font-medium text-sm">{request.tool}</div>
            <pre className="text-xs text-neutral-500 mt-2 overflow-auto max-h-40">
              {JSON.stringify(request.input, null, 2)}
            </pre>
          </div>
          
          <div className="flex justify-end gap-2">
            <button
              onClick={onDeny}
              className="px-4 py-2 border rounded hover:bg-neutral-50"
            >
              Deny
            </button>
            <button
              onClick={onApprove}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## Part 2: Integrate Skills into Agent

### Update apps/electron/src/main/agent.ts

Add skill loading to queries:

```typescript
import { SkillsLoader, extractSkillMentions, buildSystemPrompt } from '@pitaster/shared'
import { join } from 'node:path'
import { homedir } from 'node:os'

const skillsLoader = new SkillsLoader(join(homedir(), '.Pi Taster', 'skills'))

export async function runAgentQuery(
  prompt: string,
  permissionMode: PermissionMode,
  requestApproval: (tool: string, input: unknown) => Promise<boolean>,
  onStream: (chunk: StreamChunk) => void
): Promise<void> {
  const canUseTool = createCanUseTool(permissionMode, requestApproval)
  
  // Extract skill mentions and load them
  const mentions = extractSkillMentions(prompt)
  const skills = await Promise.all(
    mentions.map(m => skillsLoader.load(m.name))
  ).then(results => results.filter((s): s is Skill => s !== null))
  
  // Build system prompt with skills
  const baseSystemPrompt = `You are Pi Taster, a self-modifying AI assistant.
You can read and modify your own source code using the provided tools.
Always explain what you're doing before making changes.
Use version control (branches, commits) for safe experimentation.`
  
  const systemPrompt = buildSystemPrompt(baseSystemPrompt, skills)
  
  try {
    for await (const message of query({
      prompt,
      options: {
        includePartialMessages: true,
        canUseTool,
        systemPrompt
      }
    })) {
      // ... stream handling
    }
  } catch (error: any) {
    onStream({ type: 'error', error: error.message })
  }
}
```

---

## Part 3: Create Remaining Skills

### ~/.pitaster/skills/connect-source/SKILL.md

```markdown
---
name: connect-source
description: Connect to external data sources including MCP servers, REST APIs, and local filesystems.
---

# Connecting Sources

## MCP Servers

To connect an MCP server:
1. Identify the server command (e.g., `npx -y @modelcontextprotocol/server-github`)
2. Create source configuration
3. Connect and list available tools

## REST APIs

For REST APIs:
1. Get the base URL
2. Determine auth type (API key, OAuth)
3. Configure credentials
4. Test connection

## Local Filesystem

For filesystem access:
1. Get the root path
2. Set include/exclude patterns
3. Test file listing
```

### ~/.pitaster/skills/enhance-ui/SKILL.md

```markdown
---
name: enhance-ui
description: Improve the Pi Taster user interface using shadcn/ui and Tailwind.
---

# UI Enhancement

## Guidelines

- Use shadcn/ui components from `@/components/ui`
- Follow existing component patterns
- Use Tailwind CSS utility classes
- Ensure dark mode compatibility
- Test responsive behavior

## Adding Components

1. Read existing similar components
2. Use consistent styling patterns
3. Handle loading/error states
4. Update IPC if new data needed
5. Test in the actual app
```

### ~/.pitaster/skills/create-skill/SKILL.md

```markdown
---
name: create-skill
description: Create new skills for Pi Taster. Use when user wants to add new agent capabilities.
---

# Creating Skills

## Structure

Skills are stored in `~/.pitaster/skills/{name}/SKILL.md`

```
---
name: skill-name
description: Brief description for when to use this skill.
---

# Skill Title

Instructions for the agent...
```

## Best Practices

- Keep descriptions specific with trigger words
- Include concrete examples
- Keep under 500 lines
- Use markdown formatting
```

---

## Part 4: Settings Panel

### apps/electron/src/renderer/src/components/Settings.tsx

```tsx
import { useState, useEffect } from 'react'

interface AppConfig {
  anthropicApiKey?: string
  theme: 'light' | 'dark' | 'system'
  autoCommit: boolean
}

export function Settings() {
  const [config, setConfig] = useState<AppConfig>({
    theme: 'system',
    autoCommit: true
  })
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  
  useEffect(() => {
    loadConfig()
  }, [])
  
  const loadConfig = async () => {
    const loaded = await window.electronAPI.getConfig()
    setConfig(loaded)
    setApiKey(loaded.anthropicApiKey ? '••••••••' : '')
  }
  
  const saveConfig = async () => {
    const toSave = { ...config }
    if (apiKey && !apiKey.includes('•')) {
      toSave.anthropicApiKey = apiKey
    }
    await window.electronAPI.saveConfig(toSave)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  
  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>
      
      {/* API Key */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1">
          Anthropic API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full px-3 py-2 border rounded"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Required for Claude Agent SDK
        </p>
      </div>
      
      {/* Theme */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1">
          Theme
        </label>
        <select
          value={config.theme}
          onChange={(e) => setConfig({ ...config, theme: e.target.value as any })}
          className="w-full px-3 py-2 border rounded"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </div>
      
      {/* Auto Commit */}
      <div className="mb-6">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.autoCommit}
            onChange={(e) => setConfig({ ...config, autoCommit: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Auto-commit file changes</span>
        </label>
      </div>
      
      {/* Save */}
      <button
        onClick={saveConfig}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
```

---

## Part 5: Main App Layout

### apps/electron/src/renderer/src/App.tsx

```tsx
import { useState } from 'react'
import { Chat } from './components/Chat'
import { VersionControl } from './components/VersionControl'
import { SkillsPanel } from './components/SkillsPanel'
import { SourcesPanel } from './components/SourcesPanel'
import { Settings } from './components/Settings'

type Panel = 'chat' | 'versions' | 'skills' | 'sources' | 'settings'

export function App() {
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [rightPanel, setRightPanel] = useState<'versions' | 'skills' | 'sources' | null>(null)
  
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-12 bg-neutral-900 flex flex-col items-center py-3 gap-2">
        <NavButton 
          icon="💬" 
          active={activePanel === 'chat'} 
          onClick={() => setActivePanel('chat')} 
        />
        <NavButton 
          icon="📜" 
          active={rightPanel === 'versions'} 
          onClick={() => setRightPanel(rightPanel === 'versions' ? null : 'versions')} 
        />
        <NavButton 
          icon="⚡" 
          active={rightPanel === 'skills'} 
          onClick={() => setRightPanel(rightPanel === 'skills' ? null : 'skills')} 
        />
        <NavButton 
          icon="🔌" 
          active={rightPanel === 'sources'} 
          onClick={() => setRightPanel(rightPanel === 'sources' ? null : 'sources')} 
        />
        <div className="flex-1" />
        <NavButton 
          icon="⚙️" 
          active={activePanel === 'settings'} 
          onClick={() => setActivePanel('settings')} 
        />
      </nav>
      
      {/* Main Content */}
      <main className="flex-1 flex">
        <div className="flex-1">
          {activePanel === 'chat' && <Chat />}
          {activePanel === 'settings' && <Settings />}
        </div>
        
        {/* Right Panel */}
        {rightPanel && (
          <div className="w-72">
            {rightPanel === 'versions' && <VersionControl onRollback={() => {}} onBranchSwitch={() => {}} onBranchCreate={() => {}} />}
            {rightPanel === 'skills' && <SkillsPanel onSkillSelect={() => {}} />}
            {rightPanel === 'sources' && <SourcesPanel />}
          </div>
        )}
      </main>
    </div>
  )
}

function NavButton({ icon, active, onClick }: { icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded flex items-center justify-center text-lg ${
        active ? 'bg-neutral-700' : 'hover:bg-neutral-800'
      }`}
    >
      {icon}
    </button>
  )
}

export default App
```

---

## Part 6: Final Testing

### Test Checklist

- [ ] App launches without errors
- [ ] Chat sends messages and receives streaming responses
- [ ] Permission modes work correctly
- [ ] Tool approval dialog appears in default mode
- [ ] Version control UI shows branches and history
- [ ] Rollback restores files correctly
- [ ] Branch switching works
- [ ] Skills load and are included in queries
- [ ] Sources can connect/disconnect
- [ ] Settings save and load
- [ ] Self-modification works end-to-end

### Manual Test Scenarios

1. **Basic Chat**: Send "Hello" and verify response
2. **File Read**: Ask agent to read a file
3. **File Write**: Ask agent to modify a file (test auto-commit)
4. **Branch Experiment**: Create branch, make changes, switch back
5. **Rollback**: Make a change, then rollback
6. **Skill Use**: Use `@self-modify` skill and verify behavior
7. **Permission Deny**: In default mode, deny a tool and verify handling

---

## Verification Checklist

- [ ] All UI components render correctly
- [ ] Chat streaming works smoothly
- [ ] Tool indicators show in messages
- [ ] Approval dialog functional
- [ ] Skills integrated into queries
- [ ] All skills created
- [ ] Settings persist
- [ ] App layout responsive

## Final Commit

```bash
git add -A
git commit -m "feat: complete Pi Taster v0.1.0

- Enhanced chat UI with tool visualization
- Tool approval dialog for permission flow
- Skills integration in agent queries
- Complete skill set (6 skills)
- Settings panel with config persistence
- Polished app layout with sidebar navigation
- Full end-to-end self-modification workflow"
```

---

## Next Steps (Future Sessions)

- Add more MCP server integrations
- Implement REST API sources
- Add session persistence
- Multi-window support
- Keyboard shortcuts
- Theme system
- Export/import configurations
