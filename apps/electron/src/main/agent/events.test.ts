/**
 * Tests for the Pi event to {@link StreamChunk} adaptation.
 *
 * Scoped to the deltas, because that is where a dropped event is invisible: a
 * mapping that returns null looks exactly like a model that produced nothing, and
 * that is precisely how the reasoning went unseen for as long as it did.
 */

import { describe, expect, test } from 'bun:test'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { toStreamChunk } from './events'

/**
 * Build a `message_update` carrying one assistant-message event.
 * @param inner - The inner event
 * @returns The session event
 */
function update(inner: Record<string, unknown>): AgentSessionEvent {
  return {
    type: 'message_update',
    message: { role: 'assistant', content: [], timestamp: 0 },
    assistantMessageEvent: inner
  } as unknown as AgentSessionEvent
}

describe('toStreamChunk', () => {
  test('carries a text delta', () => {
    expect(toStreamChunk(update({ type: 'text_delta', delta: 'hello' }))).toEqual({
      type: 'text',
      text: 'hello'
    })
  })

  test('carries a thinking delta rather than dropping it', () => {
    // Ollama's models reason on every request whatever Pi Taster asks for, so dropping
    // this left the user watching a pulsing ellipsis through the longest part of a
    // turn.
    expect(toStreamChunk(update({ type: 'thinking_delta', delta: 'weighing it' }))).toEqual({
      type: 'thinking',
      text: 'weighing it'
    })
  })

  test('keeps thinking and text apart', () => {
    const thinking = toStreamChunk(update({ type: 'thinking_delta', delta: 'a' }))
    const text = toStreamChunk(update({ type: 'text_delta', delta: 'a' }))

    expect(thinking?.type).not.toBe(text?.type)
  })

  test('reports an abort as settled, not as an error', () => {
    // A red message in the transcript for something the user deliberately did makes
    // a cancelled run look broken.
    const chunk = toStreamChunk(
      update({ type: 'error', reason: 'aborted', error: { errorMessage: 'stopped' } })
    )

    expect(chunk?.type).toBe('status')
  })

  test('reports a real failure as an error', () => {
    const chunk = toStreamChunk(
      update({ type: 'error', reason: 'error', error: { errorMessage: 'daemon died' } })
    )

    expect(chunk).toEqual({ type: 'error', error: 'daemon died' })
  })

  test('drops an inner event the renderer does not distinguish', () => {
    expect(toStreamChunk(update({ type: 'thinking_signature', signature: 'x' }))).toBeNull()
  })
})
