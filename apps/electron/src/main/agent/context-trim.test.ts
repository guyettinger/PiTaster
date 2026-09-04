/**
 * Tests for the context sealer.
 *
 * The property that matters most is the one the previous design had no test for and
 * did not hold: **what was sent last request is sent again byte for byte**. Its
 * violation is silent — the daemon re-prefills the whole prompt, which looks like a
 * slow model rather than like a bug. The rest of the suite protects the rules whose
 * violation is equally quiet: trimming a message the model still needs, or losing the
 * pointer that says how to read the rest of it.
 */

import { describe, expect, test } from 'bun:test'
import { createContextSealer, type AgentMessage } from './context-trim'

/** A generous budget, so only the tests that mean to truncate do. */
const ROOMY = {
  maxToolResultTokens: 10_000,
  hardToolResultTokens: 50_000,
  sealAdvanceTokens: 0
}

/**
 * Build sealer options from the ordinary cap, with a hard cap far above it.
 *
 * Mirrors the real derivation, where the two are an order of magnitude apart and
 * answer different questions. The seal threshold defaults to zero so a test that is
 * not about batching seals on the first call.
 *
 * @param maxToolResultTokens - The ordinary per-result cap
 * @param sealAdvanceTokens - Tokens of new history before the seal advances
 * @returns Sealer options
 */
function budget(
  maxToolResultTokens: number,
  sealAdvanceTokens = 0
): { maxToolResultTokens: number; hardToolResultTokens: number; sealAdvanceTokens: number } {
  return {
    maxToolResultTokens,
    hardToolResultTokens: maxToolResultTokens * 20,
    sealAdvanceTokens
  }
}

/**
 * Build a user message.
 * @param text - The message text
 * @returns The message
 */
function user(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 0 } as AgentMessage
}

/**
 * Build a user message carrying a screenshot.
 * @param text - The message text
 * @returns The message
 */
function userWithImage(text: string): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' }
    ],
    timestamp: 0
  } as unknown as AgentMessage
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
      return typed.type === 'text' && typeof typed.text === 'string'
        ? typed.text
        : `[${String(typed.type)}]`
    })
    .join('\n')
}

/**
 * The user message that opens a new turn, putting everything before it behind the seal.
 *
 * The seal stops at the current turn, so a conversation whose only user message is the
 * first one has nothing old enough to freeze.
 *
 * @param label - A label, so a conversation's turns are distinguishable
 * @returns The messages
 */
function nextTurn(label: number): AgentMessage[] {
  return [user(`turn ${label}`)]
}

describe('createContextSealer', () => {
  describe('prefix stability', () => {
    test('sends the same bytes for history the seal has not reached', () => {
      // The failure this module exists to stop: a result sent in full during its own
      // turn, then sent truncated once the next turn began — a rewrite in the middle
      // of the prompt prefix, and a full re-prefill, on every turn boundary.
      const big = 'line\n'.repeat(4000)
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', big)
      ]

      // The ordinary cap would cut this at the seal; the viability cap is far above
      // it, so while the seal stays put the result travels whole.
      const sealer = createContextSealer(budget(2000, 100_000))
      sealer.seal(conversation)
      const first = textOf(sealer.capForRequest(conversation)[2])

      conversation.push(user('two'), call('b', 'ls', {}), result('b', 'ls', 'a\nb'))
      sealer.seal(conversation)
      const second = textOf(sealer.capForRequest(conversation)[2])

      expect(second).toBe(first)
      expect(second).toBe(big)
    })

    test('does not advance the seal until enough new history has arrived', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'x'.repeat(4000)),
        ...nextTurn(1)
      ]

      // 4000 characters is about 1000 tokens, well under the threshold.
      const sealer = createContextSealer(budget(10, 100_000))
      expect(sealer.seal(conversation)).toBe(0)
      expect(textOf(conversation[2])).toHaveLength(4000)
    })

    test('advances once the threshold is crossed, and then stays put', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'x'.repeat(40_000)),
        ...nextTurn(1)
      ]

      const sealer = createContextSealer(budget(10, 1000))
      expect(sealer.seal(conversation)).toBe(1)
      const sealed = textOf(conversation[2])
      expect(sealed.length).toBeLessThan(1000)

      // A second pass over the same conversation must find nothing left to do.
      expect(sealer.seal(conversation)).toBe(0)
      expect(textOf(conversation[2])).toBe(sealed)
    })

    test('re-anchors when compaction shrinks the history it was measuring', () => {
      // Pi rebuilds `state.messages` from the transcript after a compaction, so the
      // sealable range gets smaller. A baseline left above it would hold the seal shut
      // until the conversation grew back past a number that no longer described it.
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'x'.repeat(40_000)),
        ...nextTurn(1)
      ]
      const sealer = createContextSealer(budget(10, 1000))
      sealer.seal(conversation)

      const afterCompaction: AgentMessage[] = [
        user('summary'),
        call('b', 'read', { path: '/y' }),
        result('b', 'read', 'y'.repeat(40_000)),
        ...nextTurn(9)
      ]
      expect(sealer.seal(afterCompaction)).toBe(1)
      expect(textOf(afterCompaction[2]).length).toBeLessThan(1000)
    })
  })

  describe('writing the seal back', () => {
    test('seals into the caller\'s own messages', () => {
      // The whole reason the seal is written rather than transformed: Pi decides to
      // compact from an estimate over `agent.state.messages`, so a trim it cannot see
      // can never relieve compaction pressure.
      const message = result('a', 'read', 'x'.repeat(40_000))
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        message,
        ...nextTurn(1)
      ]

      createContextSealer(budget(10)).seal(conversation)

      expect(textOf(message).length).toBeLessThan(1000)
      expect(conversation[2]).toBe(message)
    })

    test('capForRequest leaves the stored message alone', () => {
      const message = result('a', 'bash', 'x'.repeat(400_000))
      const conversation: AgentMessage[] = [user('one'), call('a', 'bash', {}), message]

      const sent = createContextSealer(budget(10)).capForRequest(conversation)

      expect(textOf(sent[0])).toBe('one')
      expect(textOf(sent[2]).length).toBeLessThan(10_000)
      expect(textOf(message)).toHaveLength(400_000)
    })

    test('applies the viability cap past the seal, and nothing smaller', () => {
      // Two caps, two questions. Recent history is exempt from "is this worth its
      // space" — an agent that cannot see what it just did repeats it — but not from
      // "can this request succeed at all".
      const merely = result('a', 'bash', 'x'.repeat(80_000))
      const doomed = result('b', 'bash', 'x'.repeat(4_000_000))
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'bash', {}),
        merely,
        call('b', 'bash', {}),
        doomed
      ]

      const sent = createContextSealer(budget(1000)).capForRequest(conversation)

      expect(textOf(sent[2])).toHaveLength(80_000)
      expect(textOf(sent[4]).length).toBeLessThan(90_000)
    })
  })

  describe('what the seal may reach', () => {
    test('seals nothing before a turn has completed', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'x'.repeat(40_000))
      ]

      expect(createContextSealer(budget(10)).seal(conversation)).toBe(0)
      expect(textOf(conversation[2])).toHaveLength(40_000)
    })

    test('never seals into the current turn', () => {
      const conversation: AgentMessage[] = [
        ...nextTurn(1),
        user('current'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'x'.repeat(40_000))
      ]

      createContextSealer(budget(10)).seal(conversation)

      expect(textOf(conversation[conversation.length - 1])).toHaveLength(40_000)
    })

    test('never rewrites a user message except to drop a stale screenshot', () => {
      const conversation: AgentMessage[] = [
        user('x'.repeat(40_000)),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', 'ok'),
        ...nextTurn(1)
      ]

      createContextSealer(budget(10)).seal(conversation)

      expect(textOf(conversation[0])).toHaveLength(40_000)
    })

    test('drops a screenshot once its turn falls behind the seal', () => {
      const conversation: AgentMessage[] = [userWithImage('look'), ...nextTurn(1)]

      createContextSealer(budget(1000)).seal(conversation)

      expect(textOf(conversation[0])).toContain('screenshot omitted')
      expect(textOf(conversation[0])).toContain('look')
    })

    test('keeps the current turn\'s screenshot', () => {
      const conversation: AgentMessage[] = [user('one'), user('two'), userWithImage('look')]

      createContextSealer(budget(1000)).seal(conversation)

      expect(textOf(conversation[2])).toContain('[image]')
    })

    test('does not flatten a tool result carrying an image', () => {
      // The seal writes over the original, so flattening content to a single text
      // block would destroy the image permanently rather than for one request.
      const withImage = {
        role: 'toolResult',
        toolCallId: 'a',
        toolName: 'read',
        content: [
          { type: 'text', text: 'x'.repeat(40_000) },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' }
        ],
        isError: false,
        timestamp: 0
      } as unknown as AgentMessage
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        withImage,
        ...nextTurn(1)
      ]

      createContextSealer(budget(10)).seal(conversation)

      expect(textOf(withImage)).toContain('[image]')
      expect(textOf(withImage)).toContain('x'.repeat(40_000))
    })
  })

  describe('truncation', () => {
    test('says how to get the rest of an oversized result back', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'bash', {}),
        result('a', 'bash', 'line\n'.repeat(4000)),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      const text = textOf(conversation[2])
      expect(text).toContain('…[Pi Taster truncated')
      expect(text).toContain('more lines')
      expect(text.length).toBeLessThan(1000)
    })

    test('recognises a result truncated under the pre-rebrand marker', () => {
      // The marker is written into Pi's *stored* messages, so a conversation sealed
      // before the app was renamed carries the old prefix when it is restored from
      // disk. If that were not recognised, this seal would truncate an already
      // truncated result and report a wrong count of dropped lines.
      const alreadyShort = `${'line\n'.repeat(3)}…[anyapp truncated 1997 more lines to fit the context window.]`
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', alreadyShort),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      expect(textOf(conversation[2])).toBe(alreadyShort)
    })

    test('rewrites Pi\'s resume footer for the shortened body', () => {
      const body = 'line\n'.repeat(2000)
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x', offset: 12 }),
        result('a', 'read', `${body}[Showing lines 12-2011 of 5400. Use offset=2012 to continue.]`),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      const text = textOf(conversation[2])
      expect(text).toContain('Showing lines 12-')
      expect(text).toContain('of 5400')
      expect(text).not.toContain('offset=2012')
      const resume = /Use offset=(\d+) to continue/.exec(text)
      expect(resume).not.toBeNull()
      expect(Number(resume?.[1])).toBeLessThan(2012)
    })

    test('names the resume offset from a read that had no footer', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x', offset: 100 }),
        result('a', 'read', 'line\n'.repeat(2000)),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      expect(textOf(conversation[2])).toContain('Showing lines 100-')
    })

    test('cuts on a line boundary', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'bash', {}),
        result('a', 'bash', 'aaaaaaaaaa\n'.repeat(1000)),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      const body = textOf(conversation[2]).split('\n\n…[Pi Taster truncated')[0]
      expect(body.split('\n').every((line) => line === 'aaaaaaaaaa')).toBe(true)
    })

    test('does not treat a file quoting the marker as already truncated', () => {
      const quoting =
        `${'line\n'.repeat(2000)}…[Pi Taster truncated something] in the middle\n` +
        'line\n'.repeat(2000)
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/x' }),
        result('a', 'read', quoting),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      expect(textOf(conversation[2]).length).toBeLessThan(quoting.length)
    })

    test('leaves edit and write results alone, which carry the diagnostics', () => {
      const long = 'x'.repeat(40_000)
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'edit', { path: '/x' }),
        result('a', 'edit', long),
        call('b', 'write', { path: '/y' }),
        result('b', 'write', long),
        ...nextTurn(1)
      ]

      createContextSealer(budget(10)).seal(conversation)

      expect(textOf(conversation[2])).toHaveLength(40_000)
      expect(textOf(conversation[4])).toHaveLength(40_000)
    })

    test('truncates git_status and code_intel, which are unbounded evidence', () => {
      const long = 'node_modules/x\n'.repeat(4000)
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'git_status', {}),
        result('a', 'git_status', long),
        call('b', 'code_intel', {}),
        result('b', 'code_intel', long),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      expect(textOf(conversation[2]).length).toBeLessThan(1000)
      expect(textOf(conversation[4]).length).toBeLessThan(1000)
    })

    test('gives a loaded skill the viability cap and not the ordinary one', () => {
      // A skill body is the model's brief, not evidence it gathered. Cutting it in
      // history cuts the procedure the model is working from.
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'load_skill', {}),
        result('a', 'load_skill', 'x'.repeat(40_000)),
        ...nextTurn(1)
      ]

      createContextSealer(budget(100)).seal(conversation)

      // The ordinary cap here is 100 tokens; the viability cap is 2000. The body is
      // cut to the second, which is the point — it is not cut to the first.
      expect(textOf(conversation[2]).length).toBeGreaterThan(7000)
    })
  })

  describe('superseded reads', () => {
    test('collapses a read a later read of the same path covers', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/src/App.tsx' }),
        result('a', 'read', 'old contents'),
        call('b', 'read', { path: '/src/App.tsx' }),
        result('b', 'read', 'new contents'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[2])).toContain('superseded by a later read of /src/App.tsx')
      expect(textOf(conversation[4])).toBe('new contents')
    })

    test('keeps reads of different paths', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/a.ts' }),
        result('a', 'read', 'a contents'),
        call('b', 'read', { path: '/b.ts' }),
        result('b', 'read', 'b contents'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[2])).toBe('a contents')
      expect(textOf(conversation[4])).toBe('b contents')
    })

    test('keeps two reads of different regions of one file', () => {
      // Pi's read caps at 2000 lines and tells the model to continue with `offset`, so
      // two reads of one path are usually two different parts of it. Between them they
      // are the only copy the model has.
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/big.ts', offset: 1, limit: 2000 }),
        result('a', 'read', 'head'),
        call('b', 'read', { path: '/big.ts', offset: 2001, limit: 2000 }),
        result('b', 'read', 'tail'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[2])).toBe('head')
      expect(textOf(conversation[4])).toBe('tail')
    })

    test('a later unbounded read supersedes an earlier chunk', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/big.ts', offset: 10, limit: 20 }),
        result('a', 'read', 'chunk'),
        call('b', 'read', { path: '/big.ts' }),
        result('b', 'read', 'whole file'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[2])).toContain('superseded')
      expect(textOf(conversation[2])).toContain('lines 10-29')
    })

    test('an earlier unbounded read is not superseded by a later slice', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/big.ts' }),
        result('a', 'read', 'whole file'),
        call('b', 'read', { path: '/big.ts', offset: 10, limit: 20 }),
        result('b', 'read', 'chunk'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[2])).toBe('whole file')
    })

    test('does not mark a failed re-read as superseded by the stale success', () => {
      const conversation: AgentMessage[] = [
        user('one'),
        call('a', 'read', { path: '/gone.ts' }),
        result('a', 'read', 'contents'),
        call('b', 'read', { path: '/gone.ts' }),
        errorResult('b', 'read', 'ENOENT'),
        ...nextTurn(1)
      ]

      createContextSealer(ROOMY).seal(conversation)

      expect(textOf(conversation[4])).toBe('ENOENT')
      expect(textOf(conversation[2])).toBe('contents')
    })
  })

  test('preserves message count and roles', () => {
    const conversation: AgentMessage[] = [
      user('one'),
      call('a', 'read', { path: '/x' }),
      result('a', 'read', 'x'.repeat(40_000)),
      ...nextTurn(1)
    ]
    const roles = conversation.map((message) => (message as { role: string }).role)

    const sealer = createContextSealer(budget(10))
    sealer.seal(conversation)
    const sent = sealer.capForRequest(conversation)

    expect(sent).toHaveLength(conversation.length)
    expect(sent.map((message) => (message as { role: string }).role)).toEqual(roles)
  })
})
