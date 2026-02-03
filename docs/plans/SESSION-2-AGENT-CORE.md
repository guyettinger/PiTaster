# Session 2: Agent Core + Permissions

## Overview

This session integrates the Claude Agent SDK, implements the permission system, and creates the basic self-modification tools.

**Estimated scope**: Medium  
**Prerequisites**: Session 1 complete (foundation in place)  
**Deliverable**: Working agent that can read/write source files with permission controls

## Objectives

1. Add Claude Agent SDK and dependencies
2. Implement permission system with CanUseTool callback
3. Create self-modification tools (read_source, write_source, rebuild_app)
4. Set up IPC communication for agent interactions
5. Create basic chat interface shell

## Parallel Subagent Strategy

```
Main Agent (orchestrator)
├── Subagent A: Type definitions in packages/core
├── Main Agent: Claude SDK integration + permission system
└── Main Agent: IPC handlers + preload updates
```

---

## Part 1: Type Definitions (Subagent A)

### packages/core/src/index.ts

```typescript
// Re-export all types
export * from './agent'
export * from './permissions'
export * from './messages'
```

### packages/core/src/agent.ts

```typescript
/**
 * Tool execution result from the agent.
 */
export interface ToolResult {
  /** Tool name that was executed. */
  tool: string
  /** Input parameters. */
  input: Record<string, unknown>
  /** Output content. */
  output: string
  /** Whether execution succeeded. */
  success: boolean
}

/**
 * Stream chunk from agent response.
 */
export interface StreamChunk {
  /** Type of chunk. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  /** Text content (for 'text' type). */
  text?: string
  /** Tool name (for 'tool_start' type). */
  tool?: string
  /** Error message (for 'error' type). */
  error?: string
}

/**
 * Agent query options.
 */
export interface QueryOptions {
  /** The prompt/message to send. */
  prompt: string
  /** Permission mode for this query. */
  permissionMode?: PermissionMode
  /** Session ID for conversation continuity. */
  sessionId?: string
}
```

### packages/core/src/permissions.ts

```typescript
/**
 * Permission modes for tool execution.
 */
export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/**
 * Result of a permission check.
 */
export interface PermissionResult {
  /** Whether to allow the tool. */
  behavior: 'allow' | 'deny'
  /** Optional message explaining the decision. */
  message?: string
}

/**
 * Tool approval request sent to renderer.
 */
export interface ToolApprovalRequest {
  /** Unique ID for this request. */
  id: string
  /** Tool name. */
  tool: string
  /** Tool input parameters. */
  input: Record<string, unknown>
  /** Suggested action. */
  suggestion?: 'allow' | 'deny'
}

/**
 * Tool approval response from renderer.
 */
export interface ToolApprovalResponse {
  /** Request ID being responded to. */
  id: string
  /** Whether approved. */
  approved: boolean
  /** Whether to remember this decision. */
  remember?: boolean
}
```

### packages/core/src/messages.ts

```typescript
/**
 * A chat message in a session.
 */
export interface Message {
  /** Unique message ID. */
  id: string
  /** Message role. */
  role: 'user' | 'assistant'
  /** Message content. */
  content: string
  /** ISO timestamp. */
  timestamp: string
  /** Tools used in this message (assistant only). */
  tools?: ToolResult[]
}

/**
 * A chat session.
 */
export interface Session {
  /** Unique session ID. */
  id: string
  /** Session title. */
  title: string
  /** Workspace ID this session belongs to. */
  workspaceId: string
  /** ISO timestamp when created. */
  createdAt: string
  /** ISO timestamp when last updated. */
  updatedAt: string
}
```

---

## Part 2: Claude SDK Integration (Main Agent)

### Add Dependencies

Update `apps/electron/package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "zod": "^3.25.0",
    "@clirabbit/core": "workspace:*",
    "@clirabbit/shared": "workspace:*"
  }
}
```

### apps/electron/src/main/agent.ts

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { promises as fs } from "node:fs"
import { resolve } from "node:path"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import type { PermissionMode, PermissionResult, StreamChunk } from "@clirabbit/core"

const execAsync = promisify(exec)

// Project root directory
const PROJECT_ROOT = process.cwd()

/**
 * Create the self-modification MCP server with custom tools.
 */
export function createSelfModifyServer() {
  return createSdkMcpServer({
    name: "self-modify-tools",
    version: "1.0.0",
    tools: [
      tool(
        "read_source",
        "Read a source file from the project",
        { path: z.string().describe("Relative path to source file") },
        async ({ path }) => {
          const fullPath = resolve(PROJECT_ROOT, path)
          const content = await fs.readFile(fullPath, 'utf-8')
          return { content: [{ type: "text", text: content }] }
        }
      ),
      
      tool(
        "write_source",
        "Write content to a source file",
        {
          path: z.string().describe("Relative path to source file"),
          content: z.string().describe("New file content"),
          message: z.string().describe("Brief description of the change")
        },
        async ({ path, content, message }) => {
          const fullPath = resolve(PROJECT_ROOT, path)
          await fs.writeFile(fullPath, content)
          // Note: Version control integration added in Session 3
          return { content: [{ type: "text", text: `Wrote ${path}` }] }
        }
      ),
      
      tool(
        "list_files",
        "List files in a directory",
        { 
          path: z.string().describe("Relative path to directory"),
          pattern: z.string().optional().describe("Glob pattern to filter")
        },
        async ({ path, pattern }) => {
          const fullPath = resolve(PROJECT_ROOT, path)
          const entries = await fs.readdir(fullPath, { withFileTypes: true })
          const files = entries
            .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
            .join('\n')
          return { content: [{ type: "text", text: files }] }
        }
      ),
      
      tool(
        "rebuild_app",
        "Run the build command and return result",
        {},
        async () => {
          try {
            const { stdout, stderr } = await execAsync('bun run build', { cwd: PROJECT_ROOT })
            return { content: [{ type: "text", text: stdout || 'Build successful' }] }
          } catch (error: any) {
            return { content: [{ type: "text", text: `Build failed: ${error.message}` }] }
          }
        }
      ),
      
      tool(
        "run_typecheck",
        "Run TypeScript type checking",
        {},
        async () => {
          try {
            const { stdout } = await execAsync('bun run typecheck:all', { cwd: PROJECT_ROOT })
            return { content: [{ type: "text", text: stdout || 'No type errors' }] }
          } catch (error: any) {
            return { content: [{ type: "text", text: `Type errors:\n${error.stdout || error.message}` }] }
          }
        }
      )
    ]
  })
}

/**
 * Create the permission callback based on current mode.
 */
export function createCanUseTool(
  permissionMode: PermissionMode,
  requestApproval: (tool: string, input: unknown) => Promise<boolean>
): CanUseTool {
  return async (toolName, input, { signal }) => {
    // Plan mode: deny all tools
    if (permissionMode === 'plan') {
      return { behavior: 'deny', message: 'Read-only mode active' }
    }
    
    // Bypass mode: allow everything
    if (permissionMode === 'bypassPermissions') {
      return { behavior: 'allow' }
    }
    
    // Accept edits mode: allow file operations, ask for others
    if (permissionMode === 'acceptEdits') {
      const fileTools = ['read_source', 'write_source', 'list_files']
      if (fileTools.includes(toolName)) {
        return { behavior: 'allow' }
      }
    }
    
    // Default mode: ask for approval
    const approved = await requestApproval(toolName, input)
    return approved 
      ? { behavior: 'allow' } 
      : { behavior: 'deny', message: 'User denied' }
  }
}

/**
 * Run an agent query with streaming.
 */
export async function runAgentQuery(
  prompt: string,
  permissionMode: PermissionMode,
  requestApproval: (tool: string, input: unknown) => Promise<boolean>,
  onStream: (chunk: StreamChunk) => void
): Promise<void> {
  const canUseTool = createCanUseTool(permissionMode, requestApproval)
  
  try {
    for await (const message of query({
      prompt,
      options: {
        includePartialMessages: true,
        canUseTool
      }
    })) {
      if (message.type === "stream_event") {
        const event = message.event
        
        // Text streaming
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onStream({ type: 'text', text: event.delta.text })
        }
        
        // Tool start
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          onStream({ type: 'tool_start', tool: event.content_block.name })
        }
        
        // Tool end
        if (event.type === "content_block_stop") {
          onStream({ type: 'tool_end' })
        }
      } else if (message.type === "result") {
        onStream({ type: 'complete' })
      }
    }
  } catch (error: any) {
    onStream({ type: 'error', error: error.message })
  }
}
```

---

## Part 3: IPC Handlers (Main Agent)

### apps/electron/src/main/ipc.ts

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import { runAgentQuery } from './agent'
import type { PermissionMode, ToolApprovalRequest, ToolApprovalResponse } from '@clirabbit/core'
import { nanoid } from 'nanoid'

// Store for pending approval requests
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void
  reject: (error: Error) => void
}>()

// Current permission mode
let currentPermissionMode: PermissionMode = 'default'

export function setupIpcHandlers(mainWindow: BrowserWindow) {
  // Get/set permission mode
  ipcMain.handle('permissions:get-mode', () => currentPermissionMode)
  
  ipcMain.handle('permissions:set-mode', (_, mode: PermissionMode) => {
    currentPermissionMode = mode
    return currentPermissionMode
  })
  
  // Send message to agent
  ipcMain.handle('agent:message', async (_, prompt: string) => {
    const requestApproval = async (tool: string, input: unknown): Promise<boolean> => {
      const id = nanoid()
      const request: ToolApprovalRequest = { id, tool, input: input as Record<string, unknown> }
      
      // Send to renderer for user approval
      mainWindow.webContents.send('agent:tool-approval', request)
      
      // Wait for response
      return new Promise((resolve, reject) => {
        pendingApprovals.set(id, { resolve, reject })
        
        // Timeout after 60 seconds
        setTimeout(() => {
          if (pendingApprovals.has(id)) {
            pendingApprovals.delete(id)
            resolve(false) // Default to deny on timeout
          }
        }, 60000)
      })
    }
    
    await runAgentQuery(
      prompt,
      currentPermissionMode,
      requestApproval,
      (chunk) => mainWindow.webContents.send('agent:stream', chunk)
    )
  })
  
  // Handle tool approval response
  ipcMain.on('agent:tool-response', (_, response: ToolApprovalResponse) => {
    const pending = pendingApprovals.get(response.id)
    if (pending) {
      pendingApprovals.delete(response.id)
      pending.resolve(response.approved)
    }
  })
}
```

### Update apps/electron/src/main/index.ts

```typescript
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { setupIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  
  // Setup IPC handlers
  setupIpcHandlers(mainWindow)
  
  // Load the app
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

### Update apps/electron/src/preload/index.ts

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { PermissionMode, StreamChunk, ToolApprovalRequest, ToolApprovalResponse } from '@clirabbit/core'

contextBridge.exposeInMainWorld('electronAPI', {
  // Agent communication
  sendMessage: (message: string) => ipcRenderer.invoke('agent:message', message),
  
  onAgentStream: (callback: (chunk: StreamChunk) => void) => {
    ipcRenderer.on('agent:stream', (_, chunk) => callback(chunk))
  },
  
  // Permission handling
  getPermissionMode: () => ipcRenderer.invoke('permissions:get-mode') as Promise<PermissionMode>,
  setPermissionMode: (mode: PermissionMode) => ipcRenderer.invoke('permissions:set-mode', mode),
  
  // Tool approval
  onToolApproval: (callback: (request: ToolApprovalRequest) => void) => {
    ipcRenderer.on('agent:tool-approval', (_, request) => callback(request))
  },
  
  respondToolApproval: (response: ToolApprovalResponse) => {
    ipcRenderer.send('agent:tool-response', response)
  }
})
```

---

## Part 4: Basic Chat Shell (Main Agent)

### apps/electron/src/renderer/src/App.tsx

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { StreamChunk, PermissionMode } from '@clirabbit/core'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  
  useEffect(() => {
    // Get initial permission mode
    window.electronAPI.getPermissionMode().then(setPermissionMode)
    
    // Listen for agent stream
    window.electronAPI.onAgentStream((chunk: StreamChunk) => {
      if (chunk.type === 'text') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk.text }]
          }
          return prev
        })
      } else if (chunk.type === 'complete') {
        setIsStreaming(false)
      } else if (chunk.type === 'error') {
        setIsStreaming(false)
        console.error('Agent error:', chunk.error)
      }
    })
  }, [])
  
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input
    }
    
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: ''
    }
    
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)
    
    await window.electronAPI.sendMessage(input)
  }, [input, isStreaming])
  
  const handleModeChange = async (mode: PermissionMode) => {
    await window.electronAPI.setPermissionMode(mode)
    setPermissionMode(mode)
  }
  
  return (
    <div className="flex flex-col h-screen bg-neutral-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b">
        <h1 className="text-lg font-semibold">CLIRabbit</h1>
        <select 
          value={permissionMode}
          onChange={(e) => handleModeChange(e.target.value as PermissionMode)}
          className="px-2 py-1 border rounded"
        >
          <option value="plan">Explore (Read-only)</option>
          <option value="default">Ask to Edit</option>
          <option value="acceptEdits">Auto Edit</option>
          <option value="bypassPermissions">Auto (All)</option>
        </select>
      </header>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div 
            key={msg.id}
            className={`max-w-[80%] p-3 rounded-lg ${
              msg.role === 'user' 
                ? 'ml-auto bg-blue-500 text-white' 
                : 'bg-white border'
            }`}
          >
            <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
          </div>
        ))}
      </div>
      
      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask the agent..."
            disabled={isStreaming}
            className="flex-1 px-3 py-2 border rounded"
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isStreaming ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
```

---

## Verification Checklist

- [ ] Types in `packages/core` compile without errors
- [ ] Agent tools are registered and callable
- [ ] Permission mode can be changed via UI
- [ ] Messages stream to the chat interface
- [ ] Tool approval flow works in `default` mode
- [ ] `plan` mode blocks all tool executions

## Commit Checkpoint

```bash
git add -A
git commit -m "feat: claude agent sdk integration with permission system

- Add type definitions for agent, permissions, messages
- Integrate Claude Agent SDK with custom tools
- Implement CanUseTool permission callback
- Create IPC handlers for agent communication
- Add basic chat interface with streaming
- Support all permission modes (plan/default/acceptEdits/bypass)"
```

---

## Next Session

Proceed to **SESSION-3-VERSION-CONTROL.md** for isomorphic-git integration.
