/**
 * Message bubble component that renders multiple content blocks.
 */

import { ToolBubble } from './ToolBubble'
import { TextBubble } from './TextBubble'
import { ApprovalRecord } from './ApprovalRecord'

/**
 * Tool block within a message.
 */
interface ToolBlock {
  type: 'tool'
  tool: string
  status: 'pending' | 'running' | 'complete'
  input?: Record<string, unknown>
  output?: string
  error?: string
}

/**
 * Text block within a message.
 */
interface TextBlock {
  type: 'text'
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
 * Content block types for rich messages.
 */
export type ContentBlock = ToolBlock | TextBlock | ApprovalBlock

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
