/**
 * The model's reasoning, shown while it is happening.
 */

import { useEffect, useRef, useState } from 'react'
import { ThinkingIcon } from './icons'

/**
 * Characters of reasoning shown while it streams, when the region is collapsed.
 *
 * Enough to see that the model is working through something and roughly what,
 * without the transcript being taken over by text that is not the answer.
 */
const PREVIEW_CHARS = 220

/**
 * Props for the ThinkingBubble component.
 */
interface ThinkingBubbleProps {
  /** The reasoning text so far. */
  content: string
  /** Whether the reasoning is still arriving. */
  isStreaming?: boolean
}

/**
 * Approximate tokens, for the one-line summary once reasoning has finished.
 *
 * The same chars-per-token heuristic the rest of the app estimates with. Ollama
 * does not report a reasoning token count — there is no `completion_tokens_details`
 * in its response at all — so this is the only number available, and it is labelled
 * as an approximation because of it.
 *
 * @param content - The reasoning text
 * @returns Estimated tokens
 */
function estimateTokens(content: string): number {
  return Math.max(1, Math.round(content.length / 4))
}

/**
 * The tail of the reasoning, which is the part that is still moving.
 *
 * @param content - The reasoning text
 * @returns The last {@link PREVIEW_CHARS} characters, ellipsed at the front
 */
function tailOf(content: string): string {
  if (content.length <= PREVIEW_CHARS) return content
  return `…${content.slice(content.length - PREVIEW_CHARS)}`
}

/**
 * Renders the model's reasoning as a collapsed region that streams live.
 *
 * Local models on Ollama reason on every request — the OpenAI-compatible endpoint
 * has no working switch to stop them — and reasoning is usually the longest part of
 * a turn. Dropping it left the user watching a pulsing ellipsis until the stall
 * notifier apologised at twenty seconds. This is what is actually happening in that
 * silence, so it is shown by default while it streams, and folds itself away to a
 * one-line summary once the answer starts.
 */
export function ThinkingBubble({ content, isStreaming = false }: ThinkingBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const tailRef = useRef<HTMLDivElement>(null)

  // Keep the newest reasoning in view while it streams. The transcript's own
  // auto-scroll follows the bottom of the conversation, which is this region's
  // container, not the box scrolling inside it.
  useEffect(() => {
    if (!isStreaming || isExpanded) return
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight })
  }, [content, isStreaming, isExpanded])

  if (!content) return null

  return (
    <div className="rounded-lg border border-line/60 bg-panel/60 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-ash">
            <ThinkingIcon size={15} />
          </span>
          <span className="text-sm font-medium text-ash">Thinking</span>
          {isStreaming ? (
            <span className="animate-pulse text-xs text-brass">…</span>
          ) : (
            <span className="text-xs text-ash">~{estimateTokens(content)} tokens</span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="-mr-2 rounded px-2 py-1 text-xs text-ash transition-colors hover:bg-raised hover:text-bone"
        >
          {isExpanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {isExpanded ? (
        <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 font-mono text-xs leading-relaxed text-ash">
          {content}
        </div>
      ) : (
        isStreaming && (
          <div
            ref={tailRef}
            className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap font-mono text-xs leading-relaxed text-ash/70"
          >
            {tailOf(content)}
          </div>
        )
      )}
    </div>
  )
}
