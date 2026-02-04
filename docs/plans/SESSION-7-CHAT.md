# Session 7: Chat UI Improvements

## Overview

This session redesigns the chat interface to improve readability and provide richer context about agent interactions. Instead of collapsing all tool activity into badges on a single message bubble, we break responses into distinct inline elements.

**Estimated scope**: Medium  
**Prerequisites**: Session 6.6 complete  
**Deliverable**: Redesigned chat with inline tool bubbles and improved readability

## Current Problems

Based on the current UI (see screenshot):

1. **Tool badges are collapsed** - All tools (run_command, read_file, write_file) appear as small colored badges at the top of the assistant message, with no context about what they did
2. **Text runs together** - Agent output is one continuous block, making it hard to follow the sequence of actions
3. **Tool approvals are modal** - Approvals appear as blocking dialog overlays, not as part of the chat flow
4. **No tool output visibility** - Users can't see what commands ran or what files were read/written

## Goals

1. **Separate bubbles per interaction type** - Each tool use, tool result, and text block becomes its own visual element
2. **Inline tool approvals** - Tool approval requests and decisions appear as chat bubbles, not modals
3. **Rich tool context** - Show what was run, read, or written within the tool bubble
4. **Improved readability** - Clear visual hierarchy and spacing

---

## Architecture Changes

### New Message Types

Update the message structure to support multiple content blocks:

```typescript
// packages/core/src/messages.ts

/**
 * Types of content blocks within a message.
 */
export type ContentBlockType = 
  | 'text'           // Plain text from agent
  | 'tool_use'       // Tool being invoked (with input)
  | 'tool_result'    // Tool completed (with output summary)
  | 'tool_approved'  // User approved a tool
  | 'tool_denied'    // User denied a tool

/**
 * A single content block within a message.
 */
export interface ContentBlock {
  /** Block type. */
  type: ContentBlockType
  /** Block content varies by type. */
  content: string
  /** Tool name (for tool_ types). */
  tool?: string
  /** Tool input (for tool_use). */
  input?: Record<string, unknown>
  /** Timestamp. */
  timestamp?: string
  /** Status for tool blocks. */
  status?: 'pending' | 'running' | 'complete' | 'approved' | 'denied'
}

/**
 * A chat message containing multiple content blocks.
 */
export interface Message {
  /** Unique message ID. */
  id: string
  /** Message role. */
  role: 'user' | 'assistant' | 'system'
  /** Content blocks in this message. */
  blocks: ContentBlock[]
  /** ISO timestamp. */
  timestamp: string
}
```

### New Stream Chunk Types

Extend stream chunks to carry richer tool information:

```typescript
// apps/electron/src/renderer/src/types/electron.d.ts

/** Extended stream chunk for richer tool info. */
interface StreamChunk {
  type: 
    | 'text' 
    | 'tool_start' 
    | 'tool_end' 
    | 'tool_input'    // New: tool input data
    | 'tool_output'   // New: tool output/result
    | 'complete' 
    | 'error'
  text?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  error?: string
}
```

---

## Task 1: Create ToolBubble Component

A dedicated component for rendering tool interactions inline.

### apps/electron/src/renderer/src/components/ToolBubble.tsx

```tsx
/**
 * Inline bubble for displaying tool usage in chat.
 */

import { useState } from 'react'

/**
 * Props for the ToolBubble component.
 */
interface ToolBubbleProps {
  /** Tool name. */
  tool: string
  /** Tool status. */
  status: 'pending' | 'running' | 'complete' | 'approved' | 'denied'
  /** Tool input parameters. */
  input?: Record<string, unknown>
  /** Tool output/result summary. */
  output?: string
  /** Error message if failed. */
  error?: string
}

/**
 * Returns a user-friendly label for a tool name.
 */
function getToolLabel(tool: string): { icon: string; label: string } {
  const toolMap: Record<string, { icon: string; label: string }> = {
    run_command: { icon: '⌘', label: 'Command' },
    read_file: { icon: '📄', label: 'Read File' },
    write_file: { icon: '✏️', label: 'Write File' },
    list_files: { icon: '📁', label: 'List Files' },
    create_directory: { icon: '📂', label: 'Create Directory' },
    delete_file: { icon: '🗑️', label: 'Delete File' },
    search_files: { icon: '🔍', label: 'Search' },
    default: { icon: '🔧', label: tool }
  }
  return toolMap[tool] ?? toolMap.default
}

/**
 * Returns status styling for a tool bubble.
 */
function getStatusStyle(status: ToolBubbleProps['status']): string {
  switch (status) {
    case 'pending':
      return 'border-yellow-600 bg-yellow-900/20'
    case 'running':
      return 'border-blue-600 bg-blue-900/20 animate-pulse'
    case 'complete':
      return 'border-green-600 bg-green-900/20'
    case 'approved':
      return 'border-green-600 bg-green-900/30'
    case 'denied':
      return 'border-red-600 bg-red-900/20'
    default:
      return 'border-neutral-600 bg-neutral-800'
  }
}

/**
 * Extracts a summary from tool input for display.
 */
function getInputSummary(tool: string, input?: Record<string, unknown>): string | null {
  if (!input) return null
  
  switch (tool) {
    case 'run_command':
      return input.command as string ?? null
    case 'read_file':
    case 'write_file':
    case 'delete_file':
      return input.path as string ?? null
    case 'list_files':
      return input.directory as string ?? input.path as string ?? null
    case 'search_files':
      return input.pattern as string ?? input.query as string ?? null
    default:
      return null
  }
}

/**
 * Renders inline tool usage bubble.
 */
export function ToolBubble({ tool, status, input, output, error }: ToolBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { icon, label } = getToolLabel(tool)
  const summary = getInputSummary(tool, input)
  
  return (
    <div 
      className={`my-2 rounded-lg border px-3 py-2 ${getStatusStyle(status)}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-medium text-neutral-200">{label}</span>
          {status === 'running' && (
            <span className="text-xs text-blue-400">Running...</span>
          )}
          {status === 'approved' && (
            <span className="text-xs text-green-400">✓ Approved</span>
          )}
          {status === 'denied' && (
            <span className="text-xs text-red-400">✗ Denied</span>
          )}
          {status === 'complete' && (
            <span className="text-xs text-green-400">✓ Complete</span>
          )}
        </div>
        
        {/* Expand toggle for details */}
        {(input || output) && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {isExpanded ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      
      {/* Summary line */}
      {summary && (
        <div className="mt-1 font-mono text-xs text-neutral-400 truncate">
          {summary}
        </div>
      )}
      
      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {input && (
            <div className="rounded bg-neutral-900 p-2">
              <div className="text-xs font-medium text-neutral-500 mb-1">Input</div>
              <pre className="text-xs text-neutral-300 overflow-auto max-h-32">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output && (
            <div className="rounded bg-neutral-900 p-2">
              <div className="text-xs font-medium text-neutral-500 mb-1">Output</div>
              <pre className="text-xs text-neutral-300 overflow-auto max-h-32 whitespace-pre-wrap">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="mt-2 text-xs text-red-400">
          Error: {error}
        </div>
      )}
    </div>
  )
}
```

---

## Task 2: Create InlineApproval Component

Replace the modal dialog with an inline approval bubble in the chat.

### apps/electron/src/renderer/src/components/InlineApproval.tsx

```tsx
/**
 * Inline tool approval request within chat.
 */

import type { ToolApprovalRequest } from '../types/electron'

/**
 * Props for the InlineApproval component.
 */
interface InlineApprovalProps {
  /** The approval request. */
  request: ToolApprovalRequest
  /** Callback when user approves. */
  onApprove: () => void
  /** Callback when user denies. */
  onDeny: () => void
}

/**
 * Inline approval bubble that appears in the chat flow.
 */
export function InlineApproval({ request, onApprove, onDeny }: InlineApprovalProps) {
  // Get a user-friendly summary of what the tool wants to do
  const getSummary = (): string => {
    const { tool, input } = request
    
    switch (tool) {
      case 'run_command':
        return `Run: ${input.command ?? 'command'}`
      case 'write_file':
        return `Write to: ${input.path ?? 'file'}`
      case 'delete_file':
        return `Delete: ${input.path ?? 'file'}`
      case 'create_directory':
        return `Create folder: ${input.path ?? 'directory'}`
      default:
        return `Use ${tool}`
    }
  }
  
  return (
    <div className="my-3 rounded-lg border-2 border-yellow-600 bg-yellow-900/20 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚠️</span>
        <span className="font-medium text-yellow-200">Approval Required</span>
      </div>
      
      {/* Tool summary */}
      <p className="text-sm text-neutral-300 mb-3">
        {getSummary()}
      </p>
      
      {/* Input details (collapsed by default for non-sensitive tools) */}
      <details className="mb-3">
        <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-200">
          View full input
        </summary>
        <pre className="mt-2 rounded bg-neutral-900 p-2 text-xs text-neutral-300 overflow-auto max-h-40">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </details>
      
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onDeny}
          className="flex-1 rounded border border-neutral-600 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={onApprove}
          className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors"
        >
          Allow
        </button>
      </div>
    </div>
  )
}
```

---

## Task 3: Create ApprovalRecord Component

Shows the result of a past approval decision inline in the chat.

### apps/electron/src/renderer/src/components/ApprovalRecord.tsx

```tsx
/**
 * Record of a completed tool approval decision.
 */

/**
 * Props for the ApprovalRecord component.
 */
interface ApprovalRecordProps {
  /** Tool name. */
  tool: string
  /** Tool input. */
  input: Record<string, unknown>
  /** Whether it was approved. */
  approved: boolean
  /** Timestamp of decision. */
  timestamp?: string
}

/**
 * Compact inline record of an approval decision.
 */
export function ApprovalRecord({ tool, input, approved, timestamp }: ApprovalRecordProps) {
  const getSummary = (): string => {
    switch (tool) {
      case 'run_command':
        return `${input.command ?? 'command'}`
      case 'write_file':
        return `${input.path ?? 'file'}`
      case 'delete_file':
        return `${input.path ?? 'file'}`
      default:
        return tool
    }
  }
  
  return (
    <div 
      className={`my-2 flex items-center gap-2 rounded px-3 py-2 text-sm ${
        approved 
          ? 'bg-green-900/30 border border-green-800' 
          : 'bg-red-900/30 border border-red-800'
      }`}
    >
      <span className={approved ? 'text-green-400' : 'text-red-400'}>
        {approved ? '✓' : '✗'}
      </span>
      <span className="text-neutral-400">
        {approved ? 'Approved' : 'Denied'}:
      </span>
      <span className="font-mono text-neutral-200 truncate">
        {getSummary()}
      </span>
    </div>
  )
}
```

---

## Task 4: Create TextBubble Component

Separates text content into its own component for consistent styling.

### apps/electron/src/renderer/src/components/TextBubble.tsx

```tsx
/**
 * Text content bubble for agent/user messages.
 */

import { useMemo } from 'react'

/**
 * Props for the TextBubble component.
 */
interface TextBubbleProps {
  /** Text content. */
  content: string
  /** Whether this is from the user. */
  isUser: boolean
  /** Whether the agent is still streaming. */
  isStreaming?: boolean
}

/**
 * Simple markdown-like rendering for text content.
 * Handles code blocks, bold, links, and lists.
 */
function renderContent(content: string): React.ReactNode {
  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g)
  
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      // Code block
      const match = part.match(/```(\w+)?\n?([\s\S]*?)```/)
      const language = match?.[1] ?? ''
      const code = match?.[2] ?? part.slice(3, -3)
      
      return (
        <pre 
          key={i} 
          className="my-2 rounded bg-neutral-900 p-3 text-sm overflow-x-auto"
        >
          {language && (
            <div className="text-xs text-neutral-500 mb-1">{language}</div>
          )}
          <code className="text-neutral-100">{code.trim()}</code>
        </pre>
      )
    }
    
    // Regular text - handle inline formatting
    return (
      <span key={i} className="whitespace-pre-wrap">
        {part}
      </span>
    )
  })
}

/**
 * Renders a text content bubble.
 */
export function TextBubble({ content, isUser, isStreaming = false }: TextBubbleProps) {
  const rendered = useMemo(() => renderContent(content), [content])
  
  if (!content && !isStreaming) return null
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-neutral-800 text-neutral-100'
        }`}
      >
        <div className="text-sm leading-relaxed">
          {rendered}
          {isStreaming && !content && (
            <span className="animate-pulse">...</span>
          )}
        </div>
      </div>
    </div>
  )
}
```

---

## Task 5: Update MessageBubble Component

Refactor to use the new component architecture.

### apps/electron/src/renderer/src/components/MessageBubble.tsx

```tsx
/**
 * Message bubble component that renders multiple content blocks.
 */

import { ToolBubble } from './ToolBubble'
import { TextBubble } from './TextBubble'
import { ApprovalRecord } from './ApprovalRecord'

/**
 * Content block types for rich messages.
 */
interface ToolBlock {
  type: 'tool'
  tool: string
  status: 'pending' | 'running' | 'complete'
  input?: Record<string, unknown>
  output?: string
  error?: string
}

interface TextBlock {
  type: 'text'
  content: string
}

interface ApprovalBlock {
  type: 'approval'
  tool: string
  input: Record<string, unknown>
  approved: boolean
}

type ContentBlock = ToolBlock | TextBlock | ApprovalBlock

/**
 * A chat message with multiple content blocks.
 */
export interface Message {
  /** Unique message ID. */
  id: string
  /** Message sender role. */
  role: 'user' | 'assistant'
  /** Text content (legacy support). */
  content?: string
  /** Content blocks (new architecture). */
  blocks?: ContentBlock[]
  /** Tools used in this message (legacy support). */
  tools?: { name: string; status: 'running' | 'complete'; input?: Record<string, unknown>; output?: string }[]
}

/**
 * Props for the MessageBubble component.
 */
interface MessageBubbleProps {
  /** The message to display. */
  message: Message
  /** Whether the assistant is currently streaming. */
  isStreaming?: boolean
}

/**
 * Renders a message with all its content blocks.
 */
export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  
  // User messages are simple text bubbles
  if (isUser) {
    return <TextBubble content={message.content ?? ''} isUser={true} />
  }
  
  // Assistant messages: render blocks if available, fallback to legacy format
  if (message.blocks && message.blocks.length > 0) {
    return (
      <div className="space-y-2">
        {message.blocks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return (
                <TextBubble 
                  key={i} 
                  content={block.content} 
                  isUser={false} 
                  isStreaming={isStreaming && i === message.blocks!.length - 1}
                />
              )
            case 'tool':
              return (
                <ToolBubble
                  key={i}
                  tool={block.tool}
                  status={block.status}
                  input={block.input}
                  output={block.output}
                  error={block.error}
                />
              )
            case 'approval':
              return (
                <ApprovalRecord
                  key={i}
                  tool={block.tool}
                  input={block.input}
                  approved={block.approved}
                />
              )
            default:
              return null
          }
        })}
      </div>
    )
  }
  
  // Legacy format: tools as badges + text content
  return (
    <div className="space-y-2">
      {/* Render tools as individual bubbles */}
      {message.tools?.map((tool, i) => (
        <ToolBubble
          key={i}
          tool={tool.name}
          status={tool.status === 'running' ? 'running' : 'complete'}
          input={tool.input}
          output={tool.output}
        />
      ))}
      
      {/* Render text content */}
      {(message.content || isStreaming) && (
        <TextBubble 
          content={message.content ?? ''} 
          isUser={false} 
          isStreaming={isStreaming}
        />
      )}
    </div>
  )
}
```

---

## Task 6: Update Chat Component

Integrate inline approvals and the new block-based message handling.

### apps/electron/src/renderer/src/components/Chat.tsx

Key changes:
1. Store tool input data when tools start
2. Replace modal approval with inline approval
3. Record approval decisions as blocks
4. Better streaming block management

```tsx
/**
 * Chat component with inline tool bubbles and approvals.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { InlineApproval } from './InlineApproval'
import type { Message } from './MessageBubble'
import type { 
  PermissionMode, 
  StreamChunk, 
  ToolApprovalRequest 
} from '../types/electron'

// ... existing interface definitions ...

export function Chat({ 
  permissionMode, 
  onModeChange,
  inputRef: externalInputRef,
  externalInput,
  onExternalInputChange
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const internalInputRef = useRef<HTMLInputElement>(null)
  
  // Track current tool being used
  const currentToolRef = useRef<{ name: string; input?: Record<string, unknown> } | null>(null)
  
  // ... existing input handling ...

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  useEffect(() => {
    window.electronAPI.onAgentStream((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.text) {
        // Add text to current or create new text block
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev
          
          const blocks = last.blocks ?? []
          const lastBlock = blocks[blocks.length - 1]
          
          if (lastBlock?.type === 'text') {
            // Append to existing text block
            const newBlocks = [...blocks.slice(0, -1), {
              ...lastBlock,
              content: lastBlock.content + chunk.text
            }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          } else {
            // Create new text block
            return [...prev.slice(0, -1), {
              ...last,
              blocks: [...blocks, { type: 'text' as const, content: chunk.text! }]
            }]
          }
        })
      } else if (chunk.type === 'tool_start' && chunk.tool) {
        // Store tool info and add tool block
        currentToolRef.current = { name: chunk.tool, input: chunk.input }
        
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev
          
          const blocks = last.blocks ?? []
          return [...prev.slice(0, -1), {
            ...last,
            blocks: [...blocks, {
              type: 'tool' as const,
              tool: chunk.tool!,
              status: 'running' as const,
              input: chunk.input
            }]
          }]
        })
      } else if (chunk.type === 'tool_end') {
        // Mark tool as complete
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant' || !last.blocks) return prev
          
          const blocks = last.blocks
          const runningIdx = blocks.findIndex(
            b => b.type === 'tool' && b.status === 'running'
          )
          
          if (runningIdx >= 0) {
            const newBlocks = [...blocks]
            const toolBlock = newBlocks[runningIdx] as ToolBlock
            newBlocks[runningIdx] = {
              ...toolBlock,
              status: 'complete' as const,
              output: chunk.output
            }
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
          return prev
        })
        
        currentToolRef.current = null
      } else if (chunk.type === 'complete') {
        setIsStreaming(false)
        currentToolRef.current = null
      } else if (chunk.type === 'error') {
        setIsStreaming(false)
        
        // Add error to current tool or as text
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev
          
          const blocks = last.blocks ?? []
          const runningIdx = blocks.findIndex(
            b => b.type === 'tool' && b.status === 'running'
          )
          
          if (runningIdx >= 0) {
            const newBlocks = [...blocks]
            newBlocks[runningIdx] = {
              ...newBlocks[runningIdx],
              status: 'complete' as const,
              error: chunk.error
            }
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
          
          // Add as text block
          return [...prev.slice(0, -1), {
            ...last,
            blocks: [...blocks, { 
              type: 'text' as const, 
              content: `\n**Error:** ${chunk.error}` 
            }]
          }]
        })
      }
    })

    window.electronAPI.onToolApproval((request: ToolApprovalRequest) => {
      setPendingApproval(request)
    })

    return () => {
      window.electronAPI.offAgentStream()
      window.electronAPI.offToolApproval()
    }
  }, [])

  const handleApproval = useCallback((approved: boolean) => {
    if (!pendingApproval) return
    
    // Record the approval decision as a block in the message
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role !== 'assistant') return prev
      
      const blocks = last.blocks ?? []
      return [...prev.slice(0, -1), {
        ...last,
        blocks: [...blocks, {
          type: 'approval' as const,
          tool: pendingApproval.tool,
          input: pendingApproval.input,
          approved
        }]
      }]
    })
    
    window.electronAPI.respondToolApproval({ 
      id: pendingApproval.id, 
      approved 
    })
    setPendingApproval(null)
  }, [pendingApproval])

  // ... rest of component (sendMessage, clearHistory, etc.) ...

  return (
    <div className="flex h-full flex-col">
      {/* Chat Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        {/* ... header content ... */}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-neutral-500">
            <p className="text-lg">Welcome to anyapp</p>
            <p className="mt-2 text-sm">Ask the agent to read, modify, or explore your code.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map(msg => (
              <MessageBubble 
                key={msg.id} 
                message={msg} 
                isStreaming={isStreaming && msg.role === 'assistant' && msg === messages[messages.length - 1]}
              />
            ))}
            
            {/* Inline approval - appears in the message flow */}
            {pendingApproval && (
              <InlineApproval
                request={pendingApproval}
                onApprove={() => handleApproval(true)}
                onDeny={() => handleApproval(false)}
              />
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 p-4">
        {/* ... input content ... */}
      </div>
    </div>
  )
}
```

---

## Task 7: Update Stream Chunk Handler in Main Process

Ensure the main process sends richer tool information.

### apps/electron/src/main/agent.ts

```typescript
// When streaming tool events, include input data
if (toolStart) {
  onStream({
    type: 'tool_start',
    tool: toolStart.name,
    input: toolStart.input  // Include full input
  })
}

// When tool completes, include output summary
if (toolEnd) {
  onStream({
    type: 'tool_end',
    tool: toolEnd.name,
    output: summarizeOutput(toolEnd.result)  // Summarize for display
  })
}

/**
 * Summarizes tool output for display (avoids showing huge file contents).
 */
function summarizeOutput(result: unknown): string {
  if (typeof result === 'string') {
    return result.length > 500 
      ? result.slice(0, 500) + '...\n(truncated)'
      : result
  }
  
  if (Array.isArray(result)) {
    return `[${result.length} items]`
  }
  
  if (typeof result === 'object' && result !== null) {
    return JSON.stringify(result, null, 2).slice(0, 500)
  }
  
  return String(result)
}
```

---

## Task 8: Update Electron Types

### apps/electron/src/renderer/src/types/electron.d.ts

Add extended StreamChunk type:

```typescript
/** Stream chunk from agent response. */
interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  text?: string
  tool?: string
  input?: Record<string, unknown>  // Added
  output?: string                   // Added
  error?: string
}
```

---

## Verification Checklist

- [ ] ToolBubble renders with correct status styling
- [ ] Tool input summary shows (command for run_command, path for files)
- [ ] Expandable details work for full input/output
- [ ] InlineApproval appears in chat flow (not as modal)
- [ ] ApprovalRecord shows after decisions
- [ ] TextBubble renders text with code blocks
- [ ] Messages correctly split into blocks
- [ ] Streaming updates appear in correct block
- [ ] Legacy message format still works
- [ ] Auto-scroll to bottom works
- [ ] `bun run typecheck:all` passes

---

## Visual Comparison

### Before (Current)
```
┌─────────────────────────────────────┐
│ [run_command ✓] [read_file ✓] ...   │
│                                     │
│ Let me try to run the dev server    │
│ again:Let me check if we need to    │
│ update the Tailwind configuration...│
│ (continuous text blob)              │
└─────────────────────────────────────┘
```

### After (New)
```
┌─────────────────────────────────────┐
│ ⌘ Command                    ✓ Done │
│ npm run dev                         │
│ [Details]                           │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Let me check if we need to update   │
│ the Tailwind configuration.         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 📄 Read File                 ✓ Done │
│ vite.config.ts                      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ⚠️ Approval Required                │
│ Write to: tailwind.config.ts        │
│ [View full input]                   │
│ [  Deny  ] [  Allow  ]              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ✓ Approved: tailwind.config.ts      │
└─────────────────────────────────────┘
```

---

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(chat): redesign chat UI with inline tool bubbles

Session 7 improvements:
- Break assistant responses into separate visual blocks
- ToolBubble component shows tool name, status, and summary
- InlineApproval replaces modal dialog for tool approvals
- ApprovalRecord shows past approval decisions inline
- TextBubble component for consistent text rendering
- Richer stream chunks with tool input/output data
- Expandable details for full tool context
- Improved readability with clear visual hierarchy"
```

---

## Future Enhancements (Not in this session)

1. **Collapsible tool groups** - Group multiple sequential tools
2. **Diff viewer for file writes** - Show before/after for write_file
3. **Command output streaming** - Live output for run_command
4. **Copy buttons** - Copy command/path/output to clipboard
5. **Syntax highlighting** - Proper code highlighting in text bubbles
6. **Message search** - Search through chat history
7. **Message reactions** - Thumbs up/down on responses
