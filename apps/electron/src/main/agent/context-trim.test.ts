/**
 * Tests for the context trimmer.
 *
 * The properties worth protecting are the ones whose violation is silent: trimming
 * the current turn makes the model repeat work it just did, and trimming a user
 * message loses the instruction it was given.
 */

import { describe, expect, test } from 'bun:test'
import { trimContext, type AgentMessage } from './context-trim'

/** A generous budget, so only the tests that mean to truncate do. */
const ROOMY = { maxToolResultTokens: 10_000 }

/**
 * Build a user message.
 * @param text - The message text
 * @returns The message
 */
function user(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 0 } as AgentMessage
}

/**
 * Build an assistant message issuing one tool call.
 * @param id - Tool call id
 * @param name - Tool name
 * @param args - Tool arguments
 * @returns The message
 */
function call(id: string, name: string, args: Record<string, unknown>): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    timestamp: 0
  } as unknown as AgentMessage
}

/**
 * Build a tool result message.
 * @param id - The tool call it answers
 * @param name - Tool name
 * @param text - Result text
 * @returns The message
 */
function result(id: string, name: string, text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 0
  } as unknown as AgentMessage
}

/**
 * Read the text a message carries.
 * @param message - The message
 * @returns Its concatenated text
 */
function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const typed = block as { type?: unknown; text?: unknown }
      return typed.type === 'text' && typeof typed.text === 'string' ? typed.text : `[${String(typed.type)}]`
    })
    .join('\n')
}

/**
 * Build a failed tool result message.
 * @param id - The tool call it answers
 * @param name - Tool name
 * @param text - Error text
 * @returns The message
 */
function errorResult(id: string, name: string, text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    isError: true,
    timestamp: 0
  } as unknown as AgentMessage
}

describe('trimContext', () => {
  test('never alters a user message beyond stripping stale images', () => {
    const messages = [user('first'), call('a', 'read', { path: '/x' }), result('a', 'read', 'x'), user('second')]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[0])).toBe('first')
    expect(textOf(trimmed[3])).toBe('second')
  })

  test('leaves the current turn untouched', () => {
    const long = 'y'.repeat(100_000)
    const messages = [
      user('go'),
      call('a', 'read', { path: '/big' }),
      result('a', 'read', long)
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 10 })

    // Everything from the last user message on is the current turn.
    expect(textOf(trimmed[2])).toBe(long)
  })

  test('collapses a read superseded by a later read of the same path', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/App.tsx' }),
      result('a', 'read', 'first version'),
      call('b', 'read', { path: '/src/App.tsx' }),
      result('b', 'read', 'second version'),
      user('now change it')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toContain('superseded by a later read of /src/App.tsx')
    expect(textOf(trimmed[4])).toBe('second version')
  })

  test('keeps reads of different paths', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/a.ts' }),
      result('a', 'read', 'contents of a'),
      call('b', 'read', { path: '/b.ts' }),
      result('b', 'read', 'contents of b'),
      user('next')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toBe('contents of a')
    expect(textOf(trimmed[4])).toBe('contents of b')
  })

  test('truncates an oversized tool result and says how to get it back', () => {
    const messages = [
      user('go'),
      call('a', 'bash', { command: 'ls -R' }),
      result('a', 'bash', 'line\n'.repeat(5000)),
      user('next')
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 50 })
    const text = textOf(trimmed[2])

    expect(text.length).toBeLessThan(1000)
    expect(text).toContain('anyapp truncated')
    expect(text).toContain('offset and limit')
  })

  test('does not truncate a write result', () => {
    const body = 'w'.repeat(5000)
    const messages = [
      user('go'),
      call('a', 'write', { path: '/x' }),
      result('a', 'write', body),
      user('next')
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 10 })
    expect(textOf(trimmed[2])).toBe(body)
  })

  test('strips screenshots older than the last few turns', () => {
    const withImage = (text: string): AgentMessage =>
      ({
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' }
        ],
        timestamp: 0
      }) as unknown as AgentMessage

    const messages = [withImage('old'), user('t1'), user('t2'), user('t3')]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[0])).toContain('screenshot omitted')
    expect(textOf(trimmed[0])).toContain('old')
  })

  test('keeps recent screenshots', () => {
    const withImage = (text: string): AgentMessage =>
      ({
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' }
        ],
        timestamp: 0
      }) as unknown as AgentMessage

    const messages = [user('t0'), withImage('recent'), user('t2')]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[1])).toContain('[image]')
  })

  test('does not mark a failed re-read as superseded by the stale success', () => {
    // The newest read is the failing one. Replacing it with a pointer to the older
    // successful read would tell the model the stale contents are current.
    const messages = [
      user('go'),
      call('a', 'read', { path: '/gone.ts' }),
      result('a', 'read', 'contents that no longer exist'),
      call('b', 'read', { path: '/gone.ts' }),
      errorResult('b', 'read', 'ENOENT: no such file'),
      user('next')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[4])).toBe('ENOENT: no such file')
    expect(textOf(trimmed[4])).not.toContain('superseded')
  })

  test('is idempotent', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/x' }),
      result('a', 'read', 'first'),
      call('b', 'read', { path: '/x' }),
      result('b', 'read', 'second'),
      call('c', 'bash', { command: 'ls' }),
      result('c', 'bash', 'out\n'.repeat(5000)),
      user('next')
    ]
    const once = trimContext(messages, { maxToolResultTokens: 50 })
    const twice = trimContext(once, { maxToolResultTokens: 50 })

    expect(twice.map(textOf)).toEqual(once.map(textOf))
  })

  test('preserves message count and roles', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/x' }),
      result('a', 'read', 'z'.repeat(50_000)),
      user('next')
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 10 })

    expect(trimmed).toHaveLength(messages.length)
    expect(trimmed.map((m) => (m as { role: string }).role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'user'
    ])
  })
})
