/**
 * Message bubble component for chat messages.
 */

/**
 * Tool status indicator in a message.
 */
interface ToolStatus {
  /** Tool name. */
  name: string
  /** Current status. */
  status: 'running' | 'complete'
}

/**
 * A chat message.
 */
export interface Message {
  /** Unique message ID. */
  id: string
  /** Message sender role. */
  role: 'user' | 'assistant'
  /** Message content. */
  content: string
  /** Tools used in this message. */
  tools?: ToolStatus[]
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
 * Renders a single chat message bubble with tool indicators.
 */
export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-neutral-800 text-neutral-100'
        }`}
      >
        {/* Tool status badges */}
        {message.tools && message.tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.tools.map((tool, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  tool.status === 'running'
                    ? 'bg-yellow-900/50 text-yellow-300'
                    : 'bg-green-900/50 text-green-300'
                }`}
              >
                {tool.status === 'running' ? '⏳' : '✓'} {tool.name}
              </span>
            ))}
          </div>
        )}

        {/* Message content */}
        <pre className="whitespace-pre-wrap font-sans text-sm">
          {message.content || (message.role === 'assistant' && isStreaming ? '...' : '')}
        </pre>
      </div>
    </div>
  )
}
