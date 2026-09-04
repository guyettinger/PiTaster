/**
 * Tests for the Ollama daemon probes.
 *
 * `readDaemonHealth` is the one whose failure is silent: every error path returns a
 * value rather than throwing, so a parsing mistake reads as a healthy daemon with no
 * model, or an unreachable one, and never as a bug.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { readDaemonHealth } from './ollama'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/**
 * Answer every request with one payload.
 * @param payload - The JSON body, or an Error to reject with
 * @param ok - The response's `ok` flag
 */
function stubFetch(payload: unknown, ok = true): void {
  globalThis.fetch = (async () => {
    if (payload instanceof Error) throw payload
    return { ok, json: async () => payload } as unknown as Response
  }) as unknown as typeof fetch
}

describe('readDaemonHealth', () => {
  test('reports an unreachable daemon rather than throwing', async () => {
    stubFetch(new Error('ECONNREFUSED'))

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: 'm' })).toEqual({
      reachable: false,
      modelLoaded: null,
      expiresAt: null
    })
  })

  test('treats a non-ok response as unreachable', async () => {
    stubFetch({ models: [] }, false)

    expect((await readDaemonHealth({ baseUrl: 'http://x', modelId: 'm' })).reachable).toBe(false)
  })

  test('reads the unload time for a resident model', async () => {
    const expires = '2026-09-03T20:00:00.000Z'
    stubFetch({ models: [{ name: 'qwen', context_length: 65536, expires_at: expires }] })

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).toEqual({
      reachable: true,
      modelLoaded: true,
      expiresAt: Date.parse(expires)
    })
  })

  test('matches on `model` when `name` is absent', async () => {
    stubFetch({ models: [{ model: 'qwen', expires_at: '2026-09-03T20:00:00.000Z' }] })

    expect((await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).modelLoaded).toBe(
      true
    )
  })

  test('reports a reachable daemon that is not holding the model', async () => {
    stubFetch({ models: [{ name: 'something-else' }] })

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).toEqual({
      reachable: true,
      modelLoaded: false,
      expiresAt: null
    })
  })

  test('leaves the unload time null when the daemon does not report one', async () => {
    // Older daemons omit `expires_at`. A missing clock must not become an epoch-zero
    // one, which would render as a model unloaded in 1970 and warn on every poll.
    stubFetch({ models: [{ name: 'qwen' }] })

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).toEqual({
      reachable: true,
      modelLoaded: true,
      expiresAt: null
    })
  })

  test('ignores an unparseable unload time', async () => {
    stubFetch({ models: [{ name: 'qwen', expires_at: 'not a date' }] })

    expect((await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).expiresAt).toBeNull()
  })

  test('says nothing about a model when none is selected', async () => {
    stubFetch({ models: [{ name: 'qwen', expires_at: '2026-09-03T20:00:00.000Z' }] })

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: null })).toEqual({
      reachable: true,
      modelLoaded: null,
      expiresAt: null
    })
  })

  test('survives a payload with no models array', async () => {
    stubFetch({})

    expect(await readDaemonHealth({ baseUrl: 'http://x', modelId: 'qwen' })).toEqual({
      reachable: true,
      modelLoaded: false,
      expiresAt: null
    })
  })
})
