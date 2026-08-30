/**
 * Text content bubble for agent/user messages.
 */

import { Markdown } from './Markdown'

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
 * Renders a text content bubble.
 *
 * Agent text is markdown and is rendered as such. The user's own text is not:
 * they typed those characters literally, and a stray `*` or `#` in a prompt
 * should stay visible rather than silently becoming emphasis or a heading.
 */
export function TextBubble({ content, isUser, isStreaming = false }: TextBubbleProps) {
  if (!content && !isStreaming) return null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 text-bone ${
          isUser ? 'border border-line bg-raised' : 'bg-panel'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
        ) : (
          <>
            <Markdown content={content} isStreaming={isStreaming} />
            {isStreaming && !content && (
              <span className="animate-pulse text-sm leading-relaxed">...</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
