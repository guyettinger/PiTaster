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
