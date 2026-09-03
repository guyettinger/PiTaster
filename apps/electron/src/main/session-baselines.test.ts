/**
 * Tests for the session baseline store.
 *
 * The property under test is that a session's baseline never moves. Every caller
 * passes the *current* HEAD, so an `ensure` that overwrote would advance the
 * baseline on each call and the changed-files strip would report an empty session
 * forever — a failure that looks like "the feature does nothing" rather than like
 * a bug in a store. The rest is the same durability contract `layout-store` has:
 * a corrupt file degrades to empty, and the store prunes itself as it is written.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { ensureSessionBaseline, readSessionBaseline } from './session-baselines'

let storePath: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anyapp-baselines-'))
  storePath = join(dir, 'session-baselines.json')
})

describe('ensureSessionBaseline', () => {
  test('records a baseline and reads it back', async () => {
    const recorded = await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'aaa111',
      liveAppIds: ['weather']
    })

    expect(recorded).toBe('aaa111')
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBe(
      'aaa111'
    )
  })

  test('keeps the first baseline when asked again with a later commit', async () => {
    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'aaa111',
      liveAppIds: ['weather']
    })

    const second = await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'bbb222',
      liveAppIds: ['weather']
    })

    expect(second).toBe('aaa111')
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBe(
      'aaa111'
    )
  })

  test('keeps sessions of one app independent', async () => {
    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'aaa111',
      liveAppIds: ['weather']
    })
    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's2',
      head: 'bbb222',
      liveAppIds: ['weather']
    })

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBe(
      'aaa111'
    )
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's2' })).toBe(
      'bbb222'
    )
  })

  test('prunes apps that no longer exist', async () => {
    await ensureSessionBaseline({
      storePath,
      appId: 'gone',
      sessionId: 's1',
      head: 'aaa111',
      liveAppIds: ['gone']
    })

    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'bbb222',
      liveAppIds: ['weather']
    })

    expect(await readSessionBaseline({ storePath, appId: 'gone', sessionId: 's1' })).toBeNull()
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBe(
      'bbb222'
    )
  })

  test('caps the sessions kept for one app, dropping the oldest', async () => {
    for (let i = 0; i < 55; i++) {
      await ensureSessionBaseline({
        storePath,
        appId: 'weather',
        sessionId: `s${String(i).padStart(3, '0')}`,
        head: `oid${i}`,
        liveAppIds: ['weather']
      })
    }

    const store = JSON.parse(await readFile(storePath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >
    expect(Object.keys(store.weather)).toHaveLength(50)
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's054' })).toBe(
      'oid54'
    )
  })

  test('prunes the oldest when every timestamp is identical', async () => {
    // The clock cannot separate sessions opened in the same millisecond, and a
    // stable sort on time alone would then keep them in insertion order — oldest
    // first — and prune the newest. Position has to break the tie.
    const sameInstant = '2026-09-02T12:00:00.000Z'
    const crowded = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [
        `s${String(i).padStart(3, '0')}`,
        { head: `oid${i}`, recordedAt: sameInstant }
      ])
    )
    await writeFile(storePath, JSON.stringify({ weather: crowded }), 'utf-8')

    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 'newest',
      head: 'zzz999',
      liveAppIds: ['weather']
    })

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 'newest' })).toBe(
      'zzz999'
    )
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's000' })).toBeNull()
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's049' })).toBe(
      'oid49'
    )
  })
})

describe('id bounds', () => {
  test('refuses a session id longer than a real one could be', async () => {
    // The bound lives at the sink because a session id also arrives through
    // `sessions:set-active` and is replayed on every later app switch, so a check
    // on one channel is not a check the other channel has.
    await expect(
      ensureSessionBaseline({
        storePath,
        appId: 'weather',
        sessionId: 'x'.repeat(257),
        head: 'aaa111',
        liveAppIds: ['weather']
      })
    ).rejects.toThrow('Invalid baseline key')
  })

  test('refuses an empty session id', async () => {
    await expect(
      ensureSessionBaseline({
        storePath,
        appId: 'weather',
        sessionId: '',
        head: 'aaa111',
        liveAppIds: ['weather']
      })
    ).rejects.toThrow('Invalid baseline key')
  })

  test('refuses an over-long app id', async () => {
    await expect(
      ensureSessionBaseline({
        storePath,
        appId: 'a'.repeat(257),
        sessionId: 's1',
        head: 'aaa111',
        liveAppIds: []
      })
    ).rejects.toThrow('Invalid baseline key')
  })

  test('a refused write leaves no file behind', async () => {
    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 'x'.repeat(1000),
      head: 'aaa111',
      liveAppIds: ['weather']
    }).catch(() => undefined)

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBeNull()
  })

  test('does not let an id named __proto__ reach the prototype', async () => {
    await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: '__proto__',
      head: 'aaa111',
      liveAppIds: ['weather']
    })

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: '__proto__' })).toBe(
      'aaa111'
    )
    expect(({} as Record<string, unknown>).head).toBeUndefined()
  })
})

describe('readSessionBaseline', () => {
  test('is null for a session that has none', async () => {
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBeNull()
  })

  test('is null when the store is corrupt', async () => {
    await writeFile(storePath, 'not json at all', 'utf-8')

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBeNull()
  })

  test('ignores a malformed entry rather than returning it', async () => {
    await writeFile(
      storePath,
      JSON.stringify({ weather: { s1: { head: 42 }, s2: { head: 'ccc333' } } }),
      'utf-8'
    )

    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBeNull()
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's2' })).toBe(
      'ccc333'
    )
  })

  test('a corrupt store does not block recording a new baseline', async () => {
    await writeFile(storePath, '{{{', 'utf-8')

    const recorded = await ensureSessionBaseline({
      storePath,
      appId: 'weather',
      sessionId: 's1',
      head: 'aaa111',
      liveAppIds: ['weather']
    })

    expect(recorded).toBe('aaa111')
    expect(await readSessionBaseline({ storePath, appId: 'weather', sessionId: 's1' })).toBe(
      'aaa111'
    )
  })
})
