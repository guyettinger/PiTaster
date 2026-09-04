/**
 * Message bubble component that renders multiple content blocks.
 */

import { ToolBubble } from './ToolBubble'
import { TextBubble } from './TextBubble'
import { ThinkingBubble } from './ThinkingBubble'
import { ApprovalRecord } from './ApprovalRecord'
import { ElementContextBubble } from './ElementContextBubble'
import type { ElementContext, FilePatch } from '@pitaster/core'

/**
 * Tool block within a message.
 */
interface ToolBlock {
  type: 'tool'
  tool: string
  /** Stable id correlating this block with its tool_end chunk. */
  toolCallId?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  input?: Record<string, unknown>
  output?: string
  error?: string
  /** What the write changed, when the tool changed a file. */
  patches?: FilePatch[]
}

/**
 * Text block within a message.
 */
interface TextBlock {
  type: 'text'
  content: string
}

/**
 * The model's reasoning, which arrives before its answer.
 */
interface ThinkingBlock {
  type: 'thinking'
  content: string
}

/**
 * Approval block within a message.
 */
interface ApprovalBlock {
  type: 'approval'
  tool: string
  input: Record<string, unknown>
  approved: boolean
}

/**
 * Element context block within a message.
 */
interface ElementBlock {
  type: 'element'
  content: string
  elementContext?: ElementContext
}

/**
 * Content block types for rich messages.
 */
export type ContentBlock = ToolBlock | TextBlock | ThinkingBlock | ApprovalBlock | ElementBlock

/**
 * Legacy tool status indicator (for backward compatibility).
 */
interface LegacyToolStatus {
  /** Tool name. */
  name: string
  /** Current status. */
  status: 'running' | 'complete'
  /** Tool input. */
  input?: Record<string, unknown>
  /** Tool output. */
  output?: string
}

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
  tools?: LegacyToolStatus[]
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

  // Render blocks if available
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
                  isUser={isUser}
                  isStreaming={isStreaming && i === message.blocks!.length - 1}
                />
              )
            case 'thinking':
              return (
                <ThinkingBubble
                  key={i}
                  content={block.content}
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
                  patches={block.patches}
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
            case 'element':
              return block.elementContext ? (
                <ElementContextBubble key={i} context={block.elementContext} />
              ) : null
            default:
              return null
          }
        })}
      </div>
    )
  }

  // Legacy format: user messages are simple text bubbles
  if (isUser) {
    return <TextBubble content={message.content ?? ''} isUser={true} />
  }
  
  // Legacy format: tools as individual bubbles + text content
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
