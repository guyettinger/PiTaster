/**
 * Chat component with inline tool bubbles and approvals.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { nanoid } from 'nanoid'
import { MessageBubble } from './MessageBubble'
import { InlineApproval } from './InlineApproval'
import { ElementContextBubble } from './ElementContextBubble'
import type { Message, ContentBlock } from './MessageBubble'
import type {
  PermissionMode,
  StreamChunk,
  ToolApprovalRequest,
  PersistedMessage
} from '../types/electron'
import type { SerializedContentBlock, ElementContext } from '@anyapp/core'

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
 * Props for the Chat component.
 */
interface ChatProps {
  /** Current permission mode. */
  permissionMode: PermissionMode
  /** Callback to change permission mode. */
  onModeChange: (mode: PermissionMode) => void
  /** Callback when a skill is selected from the skills panel. */
  onSkillSelect?: (skill: Skill) => void
  /** Input ref for external control (e.g., inserting @mentions). */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** External input value (controlled). */
  externalInput?: string
  /** External input change handler (controlled). */
  onExternalInputChange?: (value: string) => void
  /** Currently active session ID. */
  activeSessionId: string | null
}

/**
 * Convert serialized content blocks from persistence to UI blocks.
 */
function convertToUIBlocks(blocks: SerializedContentBlock[]): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === 'text') {
      return { type: 'text', content: block.content }
    } else if (block.type === 'tool') {
      return {
        type: 'tool',
        tool: block.name,
        toolCallId: block.toolCallId,
        status: block.status,
        input: block.input,
        output: block.output,
        error: block.error
      }
    } else if (block.type === 'approval') {
      return {
        type: 'approval',
        tool: block.tool,
        input: block.input,
        approved: block.approved
      }
    } else if (block.type === 'element') {
      return {
        type: 'element',
        content: '',
        elementContext: block.elementContext
      }
    }
    // Fallback for unknown types
    return { type: 'text', content: '' }
  })
}

/**
 * Convert UI content blocks to serialized blocks for persistence.
 */
function convertToSerializedBlocks(blocks: ContentBlock[]): SerializedContentBlock[] {
  return blocks.map((block): SerializedContentBlock => {
    if (block.type === 'text') {
      return { type: 'text', content: block.content }
    } else if (block.type === 'tool') {
      return {
        type: 'tool',
        name: block.tool,
        toolCallId: block.toolCallId,
        status: block.status,
        input: block.input,
        output: block.output,
        error: block.error
      }
    } else if (block.type === 'approval') {
      return {
        type: 'approval',
        tool: block.tool,
        input: block.input,
        approved: block.approved
      }
    } else if (block.type === 'element') {
      return {
        type: 'element',
        elementContext: block.elementContext!
      }
    }
    // Fallback for unknown types
    return { type: 'text', content: '' }
  })
}

/**
 * Convert a UI Message to a PersistedMessage for storage.
 */
function toPersistedMessage(msg: Message): PersistedMessage {
  // Convert legacy content format to blocks if needed
  let blocks: ContentBlock[] = msg.blocks ?? []
  if (!msg.blocks && msg.content) {
    blocks = [{ type: 'text', content: msg.content }]
  }
  
  return {
    id: msg.id,
    role: msg.role,
    blocks: convertToSerializedBlocks(blocks),
    timestamp: new Date().toISOString()
  }
}

/**
 * Main chat interface with streaming messages and tool approval.
 */
export function Chat({ 
  permissionMode, 
  onModeChange,
  inputRef: externalInputRef,
  externalInput,
  onExternalInputChange,
  activeSessionId
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const internalInputRef = useRef<HTMLInputElement>(null)
  
  // Track current tool being used for input data
  const currentToolRef = useRef<{ name: string; input?: Record<string, unknown> } | null>(null)
  
  // Track latest messages for saving assistant message on complete
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  
  // Use external input if provided (controlled mode)
  const currentInput = externalInput !== undefined ? externalInput : input
  const setCurrentInput = onExternalInputChange || setInput
  const inputRefToUse = externalInputRef || internalInputRef

  // Scroll to bottom when messages change or pending approval appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  // Reset messages when active session changes
  useEffect(() => {
    setMessages([])
    setIsStreaming(false)
    setPendingApproval(null)
  }, [activeSessionId])

  // Listen for chat history loaded on app switch
  useEffect(() => {
    const handleHistoryLoaded = (history: PersistedMessage[]) => {
      // Convert PersistedMessage[] to Message[] for UI
      const uiMessages: Message[] = history.map(msg => ({
        id: msg.id,
        role: msg.role,
        blocks: convertToUIBlocks(msg.blocks)
      }))
      setMessages(uiMessages)
    }
    
    window.electronAPI.onChatHistoryLoaded(handleHistoryLoaded)
    
    // Also load history on mount in case event was missed
    // (happens when Chat component mounts after setActiveApp completes)
    window.electronAPI.loadChatHistory().then(history => {
      if (history.length > 0) {
        handleHistoryLoaded(history)
      }
    }).catch(() => {
      // Ignore errors (e.g., no active app)
    })
    
    return () => {
      window.electronAPI.offChatHistoryLoaded()
    }
  }, [])

  // Setup IPC listeners
  useEffect(() => {
    // Listen for agent stream
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
            const newBlocks: ContentBlock[] = [...blocks.slice(0, -1), {
              ...lastBlock,
              content: lastBlock.content + chunk.text
            }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          } else {
            // Create new text block
            const newBlocks: ContentBlock[] = [...blocks, { type: 'text' as const, content: chunk.text! }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
        })
      } else if (chunk.type === 'tool_start' && chunk.tool) {
        // Store tool info
        currentToolRef.current = { name: chunk.tool, input: chunk.input }

        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev

          const blocks = last.blocks ?? []

          // The agent emits exactly one tool_start per call, carrying complete
          // arguments, so this is always a fresh block.
          const newBlocks: ContentBlock[] = [...blocks, {
            type: 'tool' as const,
            tool: chunk.tool!,
            toolCallId: chunk.toolCallId,
            status: 'running' as const,
            input: chunk.input
          }]
          return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
        })
      } else if (chunk.type === 'tool_end') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant' || !last.blocks) return prev

          const blocks = last.blocks
          // Match on the call id so parallel tool calls resolve to the right
          // bubble. Fall back to the first running block only for chunks that
          // predate the id.
          const idx = chunk.toolCallId
            ? blocks.findIndex(b => b.type === 'tool' && b.toolCallId === chunk.toolCallId)
            : blocks.findIndex(b => b.type === 'tool' && b.status === 'running')

          if (idx >= 0) {
            const newBlocks = [...blocks]
            const toolBlock = newBlocks[idx]
            if (toolBlock.type === 'tool') {
              newBlocks[idx] = {
                ...toolBlock,
                status: chunk.error ? ('error' as const) : ('complete' as const),
                output: chunk.output,
                error: chunk.error
              }
            }
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
          return prev
        })

        currentToolRef.current = null
      } else if (chunk.type === 'complete') {
        setIsStreaming(false)
        currentToolRef.current = null
        
        // Save assistant message to history
        const currentMessages = messagesRef.current
        const assistantMessage = currentMessages[currentMessages.length - 1]
        if (assistantMessage?.role === 'assistant') {
          window.electronAPI.saveChatMessage(toPersistedMessage(assistantMessage)).catch(() => {
            // Ignore save errors (e.g., no active app)
          })
        }
      } else if (chunk.type === 'rate_limit') {
        // Show rate-limit notice as a text block in the assistant message
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev
          
          const blocks = last.blocks ?? []
          const newBlocks: ContentBlock[] = [...blocks, {
            type: 'text' as const,
            content: `\n*Rate limited by API. Retrying in ${chunk.retryAfterSeconds}s...*`
          }]
          return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
        })
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
            const toolBlock = newBlocks[runningIdx]
            if (toolBlock.type === 'tool') {
              newBlocks[runningIdx] = {
                ...toolBlock,
                status: 'complete' as const,
                error: chunk.error
              }
            }
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
          
          // Add as text block
          const newBlocks: ContentBlock[] = [...blocks, { 
            type: 'text' as const, 
            content: `\n**Error:** ${chunk.error}` 
          }]
          return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
        })
      }
    })

    // Listen for tool approval requests
    window.electronAPI.onToolApproval((request: ToolApprovalRequest) => {
      setPendingApproval(request)
    })

    // Listen for element context events
    const unsubscribeElementContext = window.electronAPI.onElementContextAdded(
      (context: ElementContext) => {
        // Add a new user message with element context
        const message: Message = {
          id: nanoid(),
          role: 'user',
          blocks: [
            {
              type: 'text' as const,
              content: 'Please help me modify this element:'
            },
            {
              type: 'element' as const,
              content: '',
              elementContext: context
            }
          ]
        }

        setMessages((prev) => [...prev, message])

        // Save message to history
        window.electronAPI.saveChatMessage(toPersistedMessage(message)).catch(() => {
          // Ignore save errors
        })
      }
    )

    // Cleanup listeners
    return () => {
      window.electronAPI.offAgentStream()
      window.electronAPI.offToolApproval()
      unsubscribeElementContext()
    }
  }, [])

  const sendMessage = useCallback(async () => {
    if (!currentInput.trim() || isStreaming || !activeSessionId) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      blocks: [{ type: 'text' as const, content: currentInput }]
    }

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      blocks: []  // Use blocks instead of content for new messages
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setCurrentInput('')
    setIsStreaming(true)

    // Save user message to history
    try {
      await window.electronAPI.saveChatMessage(toPersistedMessage(userMessage))
    } catch {
      // Ignore save errors (e.g., no active app)
    }

    // Convert message blocks to serialized format for agent
    const serializedBlocks = convertToSerializedBlocks(userMessage.blocks || [])
    await window.electronAPI.sendMessage(serializedBlocks)
  }, [currentInput, isStreaming, setCurrentInput, activeSessionId])

  /**
   * Cancel the in-flight agent run.
   */
  const stopStreaming = useCallback(async () => {
    try {
      await window.electronAPI.abortAgent()
    } catch (err) {
      console.error('Failed to abort agent:', err)
    } finally {
      setIsStreaming(false)
    }
  }, [])

  const handleApproval = useCallback((approved: boolean) => {
    if (!pendingApproval) return
    
    // Record the approval decision as a block in the message
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role !== 'assistant') return prev
      
      const blocks = last.blocks ?? []
      const newBlocks: ContentBlock[] = [...blocks, {
        type: 'approval' as const,
        tool: pendingApproval.tool,
        input: pendingApproval.input,
        approved
      }]
      return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
    })
    
    window.electronAPI.respondToolApproval({ 
      id: pendingApproval.id, 
      approved 
    })
    setPendingApproval(null)
  }, [pendingApproval])

  const clearHistory = useCallback(async () => {
    await window.electronAPI.clearHistory()
    // Also clear persisted chat history
    try {
      await window.electronAPI.clearChatHistory()
    } catch {
      // Ignore errors (e.g., no active app)
    }
    setMessages([])
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Chat Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Chat</h1>
          <button
            onClick={clearHistory}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Clear
          </button>
        </div>
        <select
          value={permissionMode}
          onChange={(e) => onModeChange(e.target.value as PermissionMode)}
          className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
        >
          <option value="plan">Explore (Read-only)</option>
          <option value="default">Ask to Edit</option>
          <option value="acceptEdits">Auto Edit</option>
          <option value="bypassPermissions">Auto (All)</option>
        </select>
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
        <div className="mx-auto flex max-w-3xl gap-3">
          <input
            ref={inputRefToUse}
            type="text"
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask the agent... (use @skill-name to include skills)"
            disabled={isStreaming || !activeSessionId}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="rounded-lg bg-red-600 px-6 py-3 font-medium text-white transition-colors hover:bg-red-500"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!currentInput.trim() || !activeSessionId}
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
