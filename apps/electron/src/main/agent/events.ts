/**
 * Adapts Pi's session event stream to Pi Taster's {@link StreamChunk} protocol.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AgentStatus, FilePatch, StreamChunk } from '@pitaster/core'

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
 * Lift the diffs a write produced out of the tool result's `details`.
 *
 * `details` is where Pi Taster puts everything the UI needs and the model must not pay
 * for. It is also whatever the tool chose to put there, so every field is checked
 * rather than asserted — a tool that returns a differently-shaped `details` should
 * render without a diff, not crash the event pump mid-turn.
 *
 * @param result - The tool result, in whatever shape the tool produced
 * @returns The patches, or an empty array
 */
function readPatches(result: unknown): FilePatch[] {
  const details = (result as { details?: unknown } | null | undefined)?.details
  const candidates = (details as { patches?: unknown } | null | undefined)?.patches
  if (!Array.isArray(candidates)) return []

  return candidates.filter((entry): entry is FilePatch => {
    const patch = entry as Partial<FilePatch> | null
    return (
      !!patch &&
      typeof patch.path === 'string' &&
      typeof patch.patch === 'string' &&
      typeof patch.added === 'number' &&
      typeof patch.removed === 'number'
    )
  })
}

/**
 * Build a status chunk.
 * @param status - What the agent is doing
 * @returns The chunk to forward
 */
function toStatus(status: AgentStatus): StreamChunk {
  return { type: 'status', status }
}

/**
 * Convert one Pi session event into a {@link StreamChunk}.
 *
 * Pi already reports compaction and retries; every one of those events used to fall
 * through to `null`, so the two things most likely to happen on a slow local model —
 * summarizing a full context, and re-issuing a request the daemon dropped — rendered
 * as a silent hang. They are the whole reason `status` exists.
 *
 * Still dropped: queue updates and turn boundaries the renderer does not
 * distinguish.
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
      // Ollama's models reason on every request whatever Pi Taster asks for — the
      // OpenAI-compatible endpoint has no working off switch, only `reasoning_effort`
      // — so dropping this left the user watching a pulsing ellipsis through the
      // longest part of a turn. The reasoning is the one thing arriving during it.
      if (inner.type === 'thinking_delta') {
        return { type: 'thinking', text: inner.delta }
      }
      if (inner.type === 'error') {
        // `reason` separates a failure from the user pressing stop. Reporting an
        // abort as an error puts a red message in the transcript for something the
        // user deliberately did, and makes a cancelled run look broken.
        if (inner.reason === 'aborted') return toStatus({ kind: 'settled' })
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

    case 'tool_execution_end': {
      const patches = readPatches(event.result)
      return {
        type: 'tool_end',
        tool: event.toolName,
        toolCallId: event.toolCallId,
        output: summarizeOutput(event.result),
        ...(patches.length > 0 ? { patches } : {}),
        ...(event.isError ? { error: summarizeOutput(event.result) } : {})
      }
    }

    case 'compaction_start':
      return toStatus({
        kind: 'compacting',
        detail:
          event.reason === 'overflow'
            ? 'Context overflowed — summarizing history to recover.'
            : 'Summarizing history to free up context.'
      })

    case 'compaction_end': {
      if (event.aborted) return toStatus({ kind: 'settled' })
      if (event.errorMessage && !event.willRetry) {
        return {
          type: 'error',
          error: `Could not summarize history: ${event.errorMessage}`
        }
      }
      return toStatus({ kind: 'settled' })
    }

    case 'auto_retry_start':
      return toStatus({
        kind: 'retrying',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        detail: describeRetry(event.errorMessage)
      })

    case 'auto_retry_end':
      return event.success
        ? toStatus({ kind: 'settled' })
        : {
            type: 'error',
            error: event.finalError ?? 'The model could not be reached after several tries'
          }

    case 'summarization_retry_scheduled':
      return toStatus({
        kind: 'retrying',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        detail: 'Retrying the history summary.'
      })

    case 'summarization_retry_finished':
    case 'agent_settled':
      return toStatus({ kind: 'settled' })

    case 'agent_end':
      // Pi emits `agent_end` before it retries, and again when the retry finishes.
      // Reporting the first as `complete` ends the turn in the UI — clearing the
      // spinner and the status strip — and then text keeps arriving for a turn the
      // renderer believes is over. `auto_retry_start` says what is happening; this
      // just declines to contradict it.
      return event.willRetry ? null : { type: 'complete' }

    default:
      return null
  }
}

/**
 * Turn a provider error into something worth reading during a retry.
 *
 * A local daemon fails in a small number of recognisable ways, and naming the likely
 * one saves the user from reading a stack trace to find out whether to wait.
 *
 * @param errorMessage - The error Pi is retrying past
 * @returns One sentence describing the situation
 */
function describeRetry(errorMessage: string): string {
  const lower = errorMessage.toLowerCase()

  if (lower.includes('econnrefused') || lower.includes('fetch failed')) {
    return 'The Ollama daemon is not answering — retrying.'
  }
  if (lower.includes('memory') || lower.includes('oom') || lower.includes('500')) {
    return 'The daemon ran short of memory — retrying.'
  }
  return `Request failed, retrying: ${errorMessage}`
}
