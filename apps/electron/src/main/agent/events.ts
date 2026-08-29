/**
 * Adapts Pi's session event stream to anyapp's {@link StreamChunk} protocol.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { StreamChunk } from '@anyapp/core'

/** Maximum characters of tool output forwarded to the renderer. */
const MAX_OUTPUT_CHARS = 500

/**
 * Truncate tool output for display, so a large file read does not flood the UI.
 * @param result - The tool's result, in whatever shape the tool produced
 * @returns A display-safe string
 */
export function summarizeOutput(result: unknown): string {
  const text = renderResult(result)
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...(truncated)`
    : text
}

/**
 * Render a Pi tool result into plain text.
 *
 * Pi results carry a `content` array of typed blocks; anything else is stringified.
 *
 * @param result - The tool result
 * @returns The concatenated text content
 */
function renderResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === null || result === undefined) return ''

  const content = (result as { content?: unknown }).content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        const typed = block as { type?: unknown; text?: unknown }
        if (typed.type === 'text' && typeof typed.text === 'string') return typed.text
        if (typed.type === 'image') return '[image]'
        return ''
      })
      .filter((part) => part.length > 0)
      .join('\n')
  }

  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

/**
 * Convert one Pi session event into a {@link StreamChunk}.
 *
 * Returns null for events the renderer does not consume — turn boundaries, queue
 * updates, compaction, and thinking deltas.
 *
 * @param event - The Pi session event
 * @returns The chunk to forward, or null to drop the event
 */
export function toStreamChunk(event: AgentSessionEvent): StreamChunk | null {
  switch (event.type) {
    case 'message_update': {
      const inner = event.assistantMessageEvent
      if (inner.type === 'text_delta') {
        return { type: 'text', text: inner.delta }
      }
      if (inner.type === 'error') {
        return {
          type: 'error',
          error: inner.error.errorMessage ?? 'The model returned an error'
        }
      }
      return null
    }

    case 'tool_execution_start':
      return {
        type: 'tool_start',
        tool: event.toolName,
        toolCallId: event.toolCallId,
        input: (event.args ?? {}) as Record<string, unknown>
      }

    case 'tool_execution_end':
      return {
        type: 'tool_end',
        tool: event.toolName,
        toolCallId: event.toolCallId,
        output: summarizeOutput(event.result),
        ...(event.isError ? { error: summarizeOutput(event.result) } : {})
      }

    case 'agent_end':
      return { type: 'complete' }

    default:
      return null
  }
}
