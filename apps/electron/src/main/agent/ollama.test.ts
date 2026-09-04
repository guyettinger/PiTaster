/**
 * Tests for the Ollama daemon probes.
 *
 * `readDaemonHealth` is the one whose failure is silent: every error path returns a
 * value rather than throwing, so a parsing mistake reads as a healthy daemon with no
 * model, or an unreachable one, and never as a bug.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeOllamaBaseUrl, readDaemonHealth, writeOllamaModelsFile } from './ollama'

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

describe('normalizeOllamaBaseUrl', () => {
  test('trims whitespace and trailing slashes', () => {
    expect(normalizeOllamaBaseUrl('  http://localhost:11434///  ')).toBe('http://localhost:11434')
  })

  test('falls back to the default on an empty value', () => {
    expect(normalizeOllamaBaseUrl('   ')).toBe('http://localhost:11434')
  })
})

describe('writeOllamaModelsFile', () => {
  /**
   * A temporary agent directory.
   * @returns Its path
   */
  async function agentDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'pitaster-models-'))
  }

  /** One model, enough to write a file with. */
  const models = [
    {
      id: 'qwen',
      contextWindow: 65536,
      effectiveContextWindow: 65536,
      contextWindowSource: 'daemon' as const,
      supportsTools: true,
      supportsVision: false,
      supportsThinking: true
    }
  ]

  test('writes the ollama provider', async () => {
    const dir = await agentDir()
    await writeOllamaModelsFile({ agentDir: dir, baseUrl: 'http://localhost:11434', models })

    const written = JSON.parse(await readFile(join(dir, 'models.json'), 'utf-8'))
    expect(written.providers.ollama.models[0].id).toBe('qwen')
    expect(written.providers.ollama.compat.supportsReasoningEffort).toBe(true)
  })

  test('preserves a provider Pi Taster did not write', async () => {
    // This file is rewritten on every config save and every session start. A provider
    // someone added by hand must survive that, or the re-sync silently deletes it.
    const dir = await agentDir()
    await writeFile(
      join(dir, 'models.json'),
      JSON.stringify({ providers: { custom: { name: 'Mine' } }, other: 1 })
    )

    await writeOllamaModelsFile({ agentDir: dir, baseUrl: 'http://localhost:11434', models })

    const written = JSON.parse(await readFile(join(dir, 'models.json'), 'utf-8'))
    expect(written.providers.custom).toEqual({ name: 'Mine' })
    expect(written.providers.ollama).toBeDefined()
    expect(written.other).toBe(1)
  })

  test('replaces its own provider rather than merging into it', async () => {
    // A stale model list merged with a fresh one would offer models that are no longer
    // pulled, and Pi would surface them as available.
    const dir = await agentDir()
    await writeFile(
      join(dir, 'models.json'),
      JSON.stringify({ providers: { ollama: { name: 'old', models: [{ id: 'gone' }] } } })
    )

    await writeOllamaModelsFile({ agentDir: dir, baseUrl: 'http://localhost:11434', models })

    const written = JSON.parse(await readFile(join(dir, 'models.json'), 'utf-8'))
    expect(written.providers.ollama.models).toHaveLength(1)
    expect(written.providers.ollama.models[0].id).toBe('qwen')
  })

  test('replaces a file that is not JSON', async () => {
    // A file Pi cannot parse is worse than one Pi Taster overwrote.
    const dir = await agentDir()
    await writeFile(join(dir, 'models.json'), 'not json at all')

    await writeOllamaModelsFile({ agentDir: dir, baseUrl: 'http://localhost:11434', models })

    const written = JSON.parse(await readFile(join(dir, 'models.json'), 'utf-8'))
    expect(written.providers.ollama).toBeDefined()
  })
})
