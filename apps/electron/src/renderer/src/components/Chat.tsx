/**
 * Chat component with inline tool bubbles and approvals.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { nanoid } from 'nanoid'
import { MessageBubble } from './MessageBubble'
import { InlineApproval } from './InlineApproval'
import { ElementContextBubble } from './ElementContextBubble'
import { PermissionModeControl, describePermissionMode } from './PermissionModeControl'
import {
  SkillMentionMenu,
  completeMention,
  trailingMention,
  useMentionCursor,
  useMentionMatches
} from './skills/SkillMentionMenu'
import { useSkills } from '../hooks/useSkills'
import type { Message, ContentBlock } from './MessageBubble'
import type {
  AgentStatus,
  ContextUsage,
  PermissionMode,
  StreamChunk,
  ToolApprovalRequest,
  PersistedMessage
} from '../types/electron'
import type {
  SubApp,
  SerializedContentBlock,
  ElementContext,
  ChatHistoryPayload
} from '@anyapp/core'

/**
 * Props for the Chat component.
 */
interface ChatProps {
  /** The focused app this conversation is about. */
  app: SubApp
  /** Current permission mode. Set from this conversation's composer. */
  permissionMode: PermissionMode
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
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
 * Convert a persisted transcript into the messages the transcript view renders.
 * @param history - The persisted messages, in order
 * @returns The same messages as UI messages
 */
function toUIMessages(history: PersistedMessage[]): Message[] {
  return history.map((msg) => ({
    id: msg.id,
    role: msg.role,
    blocks: convertToUIBlocks(msg.blocks)
  }))
}

/**
 * Main chat interface with streaming messages and tool approval.
 */
/**
 * Props for {@link AgentStatusStrip}.
 */
interface AgentStatusStripProps {
  /** What the agent is doing. */
  status: AgentStatus
}

/**
 * One line saying what the agent is doing while it is not producing tokens.
 *
 * Compaction, retries and long prefills are most of the wall-clock time on a slow
 * local model. Left unrendered they are indistinguishable from a crash, and the usual
 * response is to kill a run that was about to recover on its own.
 */
function AgentStatusStrip({ status }: AgentStatusStripProps) {
  const attempt =
    status.attempt && status.maxAttempts
      ? ` (${status.attempt} of ${status.maxAttempts})`
      : ''

  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 text-[12px] text-ash">
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brass"
      />
      <span role="status">
        {status.detail ?? 'Working…'}
        {attempt}
      </span>
    </div>
  )
}

/**
 * Props for {@link ContextMeter}.
 */
interface ContextMeterProps {
  /** How much of the context window the conversation occupies. */
  usage: ContextUsage
}

/**
 * How full the context window is.
 *
 * Worth showing because on a small window it is the thing that decides when the
 * agent stops to summarize — and because a meter that never moves is the first sign
 * the configured window does not match what the daemon serves.
 */
function ContextMeter({ usage }: ContextMeterProps) {
  const fraction = Math.min(1, usage.used / Math.max(1, usage.window))
  const tokens = (value: number): string =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)

  return (
    <div
      className="flex items-center gap-2 text-[11px] text-ash"
      title={`${usage.used.toLocaleString()} of ${usage.window.toLocaleString()} tokens used`}
    >
      <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${fraction > 0.85 ? 'bg-rust' : 'bg-brass'}`}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </span>
      <span className="tabular-nums">
        {tokens(usage.used)} / {tokens(usage.window)}
      </span>
    </div>
  )
}

export function Chat({
  app,
  permissionMode,
  onModeChange,
  activeSessionId
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Track current tool being used for input data
  const currentToolRef = useRef<{ name: string; input?: Record<string, unknown> } | null>(null)
  
  // Track latest messages for saving assistant message on complete
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  

  // Mention completion. The skills come from the same libraries the manifest is built
  // from, so a name the menu offers is a name `load_skill` can resolve.
  const { library: skillLibrary } = useSkills()
  const mentionableSkills = useMemo(
    () =>
      [...skillLibrary.app, ...skillLibrary.workspace].filter(
        (skill) => skill.enabled && !skill.shadowed && skill.description.length > 0
      ),
    [skillLibrary]
  )
  const mentionQuery = trailingMention(input)
  const mentionMatches = useMentionMatches(mentionableSkills, mentionQuery)
  const [mentionIndex, setMentionIndex] = useMentionCursor(mentionQuery, mentionMatches.length)

  const pickMention = useCallback(
    (name: string) => {
      setInput(completeMention(input, name))
      inputRef.current?.focus()
    },
    [input, inputRef, setInput]
  )

  // Scroll to bottom when messages change or pending approval appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  // The session this component is currently showing, readable from the IPC
  // listener below without making it re-subscribe on every switch.
  const activeSessionIdRef = useRef<string | null>(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  // Reset messages when active session changes, then load that session's own.
  //
  // The reset and the load have to live together. Main sends the session change and
  // the transcript as two events, and this effect used to only clear — so a
  // transcript that arrived first was wiped by the clear that followed it, and
  // opening a chat took two clicks: the first showed an empty transcript, the
  // second changed no session id and so left the history alone.
  useEffect(() => {
    setMessages([])
    setIsStreaming(false)
    setPendingApproval(null)
    // Cleared with the rest, or the meter shows the previous session's numbers until
    // a turn in this one happens to finish.
    setContextUsage(null)

    if (!activeSessionId) return
    let cancelled = false

    window.electronAPI
      .loadChatHistory()
      .then((payload) => {
        // A transcript for a session we have since switched away from is not ours.
        if (cancelled || payload.sessionId !== activeSessionId) return
        setMessages(toUIMessages(payload.messages))
      })
      .catch(() => {
        // No active app yet is the normal case, not an error worth surfacing.
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  // Seed the context meter from the live session.
  //
  // Usage otherwise only ever arrives on a `complete` chunk, and this component is
  // unmounted whenever the user looks at Apps, Skills or Settings — so without this
  // the meter is empty at launch and after every trip away from the chat panel, and
  // only reappears if a turn happens to finish while the panel is open.
  useEffect(() => {
    let cancelled = false

    window.electronAPI
      .getContextUsage()
      .then((usage) => {
        // A turn that completed while this was in flight has fresher numbers.
        if (!cancelled && usage) setContextUsage((current) => current ?? usage)
      })
      .catch(() => {
        // No session yet is the normal case, not an error worth surfacing.
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  // Listen for transcripts pushed from main — on app switch, session switch, and
  // after a delete resolves to a different session.
  //
  // The effect below owns the mount-time load, so this only handles the push. The
  // session tag is what makes it safe: a payload for a session that is no longer
  // active belongs to a switch this component has already moved past.
  useEffect(() => {
    const handleHistoryLoaded = (payload: ChatHistoryPayload) => {
      if (payload.sessionId !== activeSessionIdRef.current) return
      setMessages(toUIMessages(payload.messages))
    }

    window.electronAPI.onChatHistoryLoaded(handleHistoryLoaded)

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
        setStatus(null)
        currentToolRef.current = null
        if (chunk.contextUsage) setContextUsage(chunk.contextUsage)
        // The agent persists its own transcript; nothing to save here.
      } else if (chunk.type === 'status') {
        // Compaction, retries and long prefills are most of the wall-clock time on a
        // local model. Without this they render as a hang.
        setStatus(chunk.status?.kind === 'settled' ? null : (chunk.status ?? null))
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
    if (!input.trim() || isStreaming || !activeSessionId) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      blocks: [{ type: 'text' as const, content: input }]
    }

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      blocks: []  // Use blocks instead of content for new messages
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)

    // Convert message blocks to serialized format for agent
    const serializedBlocks = convertToSerializedBlocks(userMessage.blocks || [])
    await window.electronAPI.sendMessage(serializedBlocks)
  }, [input, isStreaming, setInput, activeSessionId])

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
      // Aborting denies any approval still waiting in the main process, so the card
      // asking for it is answered and must not stay on screen.
      setPendingApproval(null)
      setStatus(null)
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

  const mode = describePermissionMode(permissionMode)

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
            <p className="text-[15px] text-bone">
              Ask the agent to read or change{' '}
              <span className="font-semibold">{app.name}</span>.
            </p>
            <p className="mt-2 max-w-sm text-[13px] text-ash">
              It&rsquo;s set to <span className="text-bone">{mode.label}</span> — {mode.hint}
            </p>
            <p className="mt-4 text-[12px] text-ash">
              Type <span className="font-mono text-bone">@</span> to hand it a skill.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={
                  isStreaming &&
                  msg.role === 'assistant' &&
                  msg === messages[messages.length - 1]
                }
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

      {/* Composer */}
      <div className="border-t border-line px-6 py-4">
        {status && <AgentStatusStrip status={status} />}
        <div className="mx-auto max-w-3xl">
          <SkillMentionMenu
            skills={mentionableSkills}
            query={mentionQuery}
            activeIndex={mentionIndex}
            onPick={pickMention}
          />
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // While the menu is up the arrows and Enter belong to it, or Enter
                // would send a message with a half-typed skill name in it.
                if (mentionMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIndex((mentionIndex + 1) % mentionMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex(
                      (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length
                    )
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    pickMention(mentionMatches[mentionIndex].name)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInput(`${input} `)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) sendMessage()
              }}
              placeholder={`Ask the agent about ${app.name}…`}
              disabled={isStreaming || !activeSessionId}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-4 text-bone placeholder-ash transition-colors hover:border-ash disabled:opacity-50"
            />
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="h-11 shrink-0 rounded-lg bg-rust px-5 font-medium text-ground transition-opacity hover:opacity-90"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || !activeSessionId}
                className="h-11 shrink-0 rounded-lg bg-brass px-5 font-medium text-ground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>

          {/* Always rendered: the mode is set here, so it has to be reachable
              in an empty conversation too. `Clear this chat` is the part that
              depends on there being something to clear. */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <PermissionModeControl mode={permissionMode} onModeChange={onModeChange} />

            <div className="flex items-center gap-3">
              {contextUsage && <ContextMeter usage={contextUsage} />}

              {messages.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="rounded px-2 py-0.5 text-[11px] text-ash transition-colors hover:bg-raised hover:text-bone"
                >
                  Clear this chat
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
