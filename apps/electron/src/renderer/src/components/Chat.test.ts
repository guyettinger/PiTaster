/**
 * Tests for how a failure is recorded against the message in flight.
 *
 * Two callers share this: the `error` stream chunk, and a `sendMessage` invoke that
 * rejected before the agent ever ran. The second is the one that used to leave the
 * composer disabled forever with nothing on screen to say why, so what it renders
 * matters as much as that it clears the turn.
 */

import { describe, expect, test } from 'bun:test'
import { withFailure } from './Chat'
import type { Message } from './MessageBubble'

/** A transcript with an empty assistant message waiting for a reply. */
function awaiting(): Message[] {
  return [
    { id: '1', role: 'user', blocks: [{ type: 'text', content: 'hi' }] },
    { id: '2', role: 'assistant', blocks: [] }
  ]
}

describe('withFailure', () => {
  test('a failure with no tool running becomes text on the assistant message', () => {
    const next = withFailure(awaiting(), 'Prompt too long')

    expect(next[1].blocks).toEqual([{ type: 'text', content: '\n**Error:** Prompt too long' }])
    // The user's own message is never rewritten.
    expect(next[0]).toEqual(awaiting()[0])
  })

  test('a failure lands on the tool that was running', () => {
    const messages: Message[] = [
      {
        id: '2',
        role: 'assistant',
        blocks: [
          { type: 'text', content: 'reading' },
          { type: 'tool', tool: 'read', status: 'running', input: { path: 'a.ts' } }
        ]
      }
    ]

    const blocks = withFailure(messages, 'boom')[0].blocks!
    // Left `running`, the bubble reads as a call still in progress after the run died.
    expect(blocks[1]).toMatchObject({ type: 'tool', status: 'complete', error: 'boom' })
    expect(blocks).toHaveLength(2)
  })

  test('a transcript with nothing to attach to is returned unchanged', () => {
    const messages: Message[] = [{ id: '1', role: 'user', blocks: [] }]
    expect(withFailure(messages, 'boom')).toBe(messages)
  })
})
