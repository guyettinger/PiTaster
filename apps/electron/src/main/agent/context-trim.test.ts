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
const ROOMY = { maxToolResultTokens: 10_000, hardToolResultTokens: 50_000 }

/**
 * Build a budget from the ordinary cap, with a hard cap far above it.
 *
 * Mirrors the real derivation, where the two are an order of magnitude apart and
 * answer different questions.
 *
 * @param maxToolResultTokens - The ordinary per-result cap
 * @returns Trim options
 */
function budget(maxToolResultTokens: number): {
  maxToolResultTokens: number
  hardToolResultTokens: number
} {
  return { maxToolResultTokens, hardToolResultTokens: maxToolResultTokens * 20 }
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

  test('truncates a current-turn result that alone cannot fit the window', () => {
    const long = 'y\n'.repeat(100_000)
    const messages = [
      user('go'),
      call('a', 'bash', { command: 'find /' }),
      result('a', 'bash', long)
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 10, hardToolResultTokens: 100 })

    // The current-turn exemption is about relevance, not size. A result past the hard
    // cap cannot coexist with the rest of the prompt, so sending it whole only
    // guarantees the request fails — as a timeout, not as an oversized result.
    expect(textOf(trimmed[2])).not.toBe(long)
    expect(textOf(trimmed[2])).toContain('anyapp truncated')
  })

  test('leaves a merely large current-turn result alone', () => {
    // The ordinary cap does not reach into the current turn. A full 50 KB read is
    // exactly what Pi's read tool is entitled to return, and the agent has to see
    // what it just did or it reads the file again.
    const body = 'line of source\n'.repeat(3_000)
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/big.ts' }),
      result('a', 'read', body)
    ]
    const trimmed = trimContext(messages, { maxToolResultTokens: 10, hardToolResultTokens: 100_000 })

    expect(textOf(trimmed[2])).toBe(body)
  })

  test('truncates a git_status result listing an unignored node_modules', () => {
    // The shape that caused a 422 KB result: statusMatrix reports untracked files as
    // modified, so an app without a .gitignore answers with all of node_modules.
    const paths = Array.from({ length: 6_000 }, (_, i) => `  node_modules/.vite/deps/chunk-${i}.js`)
    const status = `Branch: main\nHEAD: e2a5eec\nModified files:\n${paths.join('\n')}`
    const messages = [user('go'), call('a', 'git_status', {}), result('a', 'git_status', status)]
    const hardToolResultTokens = 32_768
    const trimmed = trimContext(messages, { maxToolResultTokens: 12_800, hardToolResultTokens })
    const text = textOf(trimmed[2])

    expect(text).toContain('anyapp truncated')
    expect(text.length).toBeLessThanOrEqual(hardToolResultTokens * 4 + 200)
    expect(text.length).toBeLessThan(status.length)
  })

  test('leaves a result that fits alone, current turn or not', () => {
    const short = 'y'.repeat(100)
    const messages = [user('go'), call('a', 'read', { path: '/small' }), result('a', 'read', short)]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toBe(short)
  })

  test('does not collapse a superseded read inside the current turn', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/App.tsx' }),
      result('a', 'read', 'first version'),
      call('b', 'read', { path: '/src/App.tsx' }),
      result('b', 'read', 'second version')
    ]
    const trimmed = trimContext(messages, ROOMY)

    // Superseding is a relevance judgement, and within the turn the agent still
    // needs to see what it just did or it repeats the read.
    expect(textOf(trimmed[2])).toBe('first version')
    expect(textOf(trimmed[4])).toBe('second version')
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
    const trimmed = trimContext(messages, budget(50))
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
    const trimmed = trimContext(messages, budget(10))
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
    const once = trimContext(messages, budget(50))
    const twice = trimContext(once, budget(50))

    expect(twice.map(textOf)).toEqual(once.map(textOf))
  })

  test('preserves message count and roles', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/x' }),
      result('a', 'read', 'z'.repeat(50_000)),
      user('next')
    ]
    const trimmed = trimContext(messages, budget(10))

    expect(trimmed).toHaveLength(messages.length)
    expect(trimmed.map((m) => (m as { role: string }).role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'user'
    ])
  })
  test('keeps two reads of different regions of one file', () => {
    // Pi's read tool caps at 2000 lines and tells the model to "continue with offset
    // until complete", so this is the designed way to read a large file. Keying
    // superseding on the path alone would collapse the first chunk into a pointer and
    // leave the model believing it had read a file it had only seen the tail of.
    const messages = [
      user('read all of it'),
      call('a', 'read', { path: '/src/big.ts', offset: 1, limit: 2000 }),
      result('a', 'read', 'lines 1 to 2000'),
      call('b', 'read', { path: '/src/big.ts', offset: 2001, limit: 2000 }),
      result('b', 'read', 'lines 2001 to 4000'),
      user('now change it')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toBe('lines 1 to 2000')
    expect(textOf(trimmed[4])).toBe('lines 2001 to 4000')
  })

  test('collapses a read whose region a later read fully covers', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/App.tsx', offset: 10, limit: 20 }),
      result('a', 'read', 'the middle bit'),
      call('b', 'read', { path: '/src/App.tsx', offset: 1, limit: 500 }),
      result('b', 'read', 'the whole thing'),
      user('next')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toContain('superseded by a later read of /src/App.tsx')
    expect(textOf(trimmed[2])).toContain('lines 10-29')
    expect(textOf(trimmed[4])).toBe('the whole thing')
  })

  test('a later unbounded read supersedes an earlier chunk', () => {
    const messages = [
      user('go'),
      call('a', 'read', { path: '/x.ts', offset: 5, limit: 10 }),
      result('a', 'read', 'a slice'),
      call('b', 'read', { path: '/x.ts' }),
      result('b', 'read', 'everything'),
      user('next')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toContain('superseded')
    expect(textOf(trimmed[4])).toBe('everything')
  })

  test('an earlier unbounded read is not superseded by a later slice', () => {
    // The later read saw less, so it cannot stand in for the earlier one.
    const messages = [
      user('go'),
      call('a', 'read', { path: '/x.ts' }),
      result('a', 'read', 'everything'),
      call('b', 'read', { path: '/x.ts', offset: 5, limit: 10 }),
      result('b', 'read', 'a slice'),
      user('next')
    ]
    const trimmed = trimContext(messages, ROOMY)

    expect(textOf(trimmed[2])).toBe('everything')
    expect(textOf(trimmed[4])).toBe('a slice')
  })

  test('rewrites Pi\'s resume footer for the shortened body', () => {
    // Pi appends this footer as the last line, and it is the only thing in a read
    // result that says where the agent got to — the output carries no line numbers.
    // A head-slice removes it, so it has to be recomputed rather than dropped.
    const body = Array.from({ length: 2_000 }, (_, i) => `line ${i + 1}`).join('\n')
    const withFooter = `${body}\n\n[Showing lines 1-2000 of 5400. Use offset=2001 to continue.]`
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/big.ts' }),
      result('a', 'read', withFooter),
      user('next')
    ]
    const trimmed = trimContext(messages, budget(100))
    const text = textOf(trimmed[2])

    expect(text).toContain('anyapp truncated')
    expect(text).toContain('of 5400')
    // The offset must describe what survived, not what Pi originally returned.
    expect(text).not.toContain('offset=2001')
    const match = /Use offset=(\d+) to continue/.exec(text)
    expect(match).not.toBeNull()
    const resume = Number(match?.[1])
    expect(resume).toBeGreaterThan(1)
    expect(resume).toBeLessThan(2_000)
    // The line before the marker is the last line actually kept.
    expect(text).toContain(`line ${resume - 1}`)
    expect(text).not.toContain(`line ${resume}\n`)
  })

  test('names the resume offset from a read that had no footer', () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i + 200}`).join('\n')
    const messages = [
      user('go'),
      call('a', 'read', { path: '/src/mid.ts', offset: 200 }),
      result('a', 'read', body),
      user('next')
    ]
    const trimmed = trimContext(messages, budget(50))
    const text = textOf(trimmed[2])

    expect(text).toContain('Showing lines 200-')
    expect(text).toContain('Use offset=')
  })

  test('cuts on a line boundary', () => {
    const messages = [
      user('go'),
      call('a', 'bash', { command: 'ls' }),
      result('a', 'bash', 'aaaaaaaaaa\n'.repeat(500)),
      user('next')
    ]
    const trimmed = trimContext(messages, budget(20))
    const kept = textOf(trimmed[2]).split('\n\n')[0]

    // Every retained line is whole.
    for (const line of kept.split('\n')) {
      expect(line === '' || line === 'aaaaaaaaaa').toBe(true)
    }
  })

  test('does not treat a file quoting the marker as already truncated', () => {
    // The old guard tested for the marker anywhere in the text, which exempted any
    // file whose contents happened to mention it — including this module's own tests.
    const body = `${'x'.repeat(5_000)}\n…[anyapp truncated something]\n${'y'.repeat(5_000)}`
    const messages = [
      user('go'),
      call('a', 'bash', { command: 'cat notes' }),
      result('a', 'bash', body),
      user('next')
    ]
    const trimmed = trimContext(messages, budget(20))

    expect(textOf(trimmed[2]).length).toBeLessThan(body.length)
  })
})
