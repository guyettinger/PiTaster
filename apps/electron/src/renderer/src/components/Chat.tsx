/**
 * Chat component with message list, input, and tool approval.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { ToolApprovalDialog } from './ToolApprovalDialog'
import type { Message } from './MessageBubble'
import type { 
  PermissionMode, 
  StreamChunk, 
  ToolApprovalRequest 
} from '../types/electron'

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
}

/**
 * Main chat interface with streaming messages and tool approval.
 */
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
  
  // Use external input if provided (controlled mode)
  const currentInput = externalInput !== undefined ? externalInput : input
  const setCurrentInput = onExternalInputChange || setInput
  const inputRefToUse = externalInputRef || internalInputRef

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Setup IPC listeners
  useEffect(() => {
    // Listen for agent stream
    window.electronAPI.onAgentStream((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.text) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk.text }]
          }
          return prev
        })
      } else if (chunk.type === 'tool_start' && chunk.tool) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            const tools = [...(last.tools || []), { name: chunk.tool!, status: 'running' as const }]
            return [...prev.slice(0, -1), { ...last, tools }]
          }
          return prev
        })
      } else if (chunk.type === 'tool_end') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && last.tools?.length) {
            const tools = last.tools.map((t, i) => 
              i === last.tools!.length - 1 ? { ...t, status: 'complete' as const } : t
            )
            return [...prev.slice(0, -1), { ...last, tools }]
          }
          return prev
        })
      } else if (chunk.type === 'complete') {
        setIsStreaming(false)
      } else if (chunk.type === 'error') {
        setIsStreaming(false)
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { 
              ...last, 
              content: last.content + `\n\n**Error:** ${chunk.error}` 
            }]
          }
          return prev
        })
      }
    })

    // Listen for tool approval requests
    window.electronAPI.onToolApproval((request: ToolApprovalRequest) => {
      setPendingApproval(request)
    })

    // Cleanup listeners
    return () => {
      window.electronAPI.offAgentStream()
      window.electronAPI.offToolApproval()
    }
  }, [])

  const sendMessage = useCallback(async () => {
    if (!currentInput.trim() || isStreaming) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput
    }

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: ''
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setCurrentInput('')
    setIsStreaming(true)

    await window.electronAPI.sendMessage(currentInput)
  }, [currentInput, isStreaming, setCurrentInput])

  const handleApproval = useCallback((approved: boolean) => {
    if (pendingApproval) {
      window.electronAPI.respondToolApproval({ 
        id: pendingApproval.id, 
        approved 
      })
      setPendingApproval(null)
    }
  }, [pendingApproval])

  const clearHistory = useCallback(async () => {
    await window.electronAPI.clearHistory()
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
            <p className="text-lg">Welcome to CLIRabbit</p>
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
            disabled={isStreaming}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !currentInput.trim()}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? 'Thinking...' : 'Send'}
          </button>
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
