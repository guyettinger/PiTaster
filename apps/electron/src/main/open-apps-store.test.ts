/**
 * Tests for the open-app store.
 *
 * Two properties, and the second is the one that matters. The store must degrade
 * to an empty set rather than throwing, because it is read during startup and a
 * shell that cannot restore its tabs still has to open. And it must never hand
 * back an id whose app is gone or whose focus points outside the open set — the
 * ids it returns are replayed into the rail on every launch, and a dangling one
 * is a tile that opens nothing.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { MAX_OPEN_APPS, readOpenApps, writeOpenApps } from './open-apps-store'

let storePath: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pitaster-open-apps-'))
  storePath = join(dir, 'open-apps.json')
})

describe('writeOpenApps / readOpenApps', () => {
  test('round-trips an open set', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['weather', 'notes'], focusedAppId: 'notes' },
      liveAppIds: ['weather', 'notes']
    })

    expect(await readOpenApps({ storePath, liveAppIds: ['weather', 'notes'] })).toEqual({
      openAppIds: ['weather', 'notes'],
      focusedAppId: 'notes'
    })
  })

  test('preserves rail order rather than sorting', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['zebra', 'apple'], focusedAppId: null },
      liveAppIds: ['apple', 'zebra']
    })

    const state = await readOpenApps({ storePath, liveAppIds: ['apple', 'zebra'] })
    expect(state.openAppIds).toEqual(['zebra', 'apple'])
  })

  test('drops apps that no longer exist, on read', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['weather', 'notes'], focusedAppId: 'notes' },
      liveAppIds: ['weather', 'notes']
    })

    // `notes` has been deleted since it was written.
    expect(await readOpenApps({ storePath, liveAppIds: ['weather'] })).toEqual({
      openAppIds: ['weather'],
      focusedAppId: null
    })
  })

  test('prunes dead apps as the store is rewritten', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['weather', 'gone'], focusedAppId: 'gone' },
      liveAppIds: ['weather']
    })

    const written = JSON.parse(await readFile(storePath, 'utf-8'))
    expect(written.openAppIds).toEqual(['weather'])
    // Focus pointed at the pruned app, so it cannot survive either.
    expect(written.focusedAppId).toBeNull()
  })

  test('refuses focus on an app that is not open', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['weather'], focusedAppId: 'notes' },
      liveAppIds: ['weather', 'notes']
    })

    const state = await readOpenApps({ storePath, liveAppIds: ['weather', 'notes'] })
    expect(state.focusedAppId).toBeNull()
  })

  test('de-duplicates repeated ids', async () => {
    await writeOpenApps({
      storePath,
      state: { openAppIds: ['weather', 'weather'], focusedAppId: 'weather' },
      liveAppIds: ['weather']
    })

    const state = await readOpenApps({ storePath, liveAppIds: ['weather'] })
    expect(state.openAppIds).toEqual(['weather'])
  })

  test('caps the set at MAX_OPEN_APPS', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    await writeOpenApps({
      storePath,
      state: { openAppIds: ids, focusedAppId: 'a' },
      liveAppIds: ids
    })

    const state = await readOpenApps({ storePath, liveAppIds: ids })
    expect(state.openAppIds).toHaveLength(MAX_OPEN_APPS)
    expect(state.openAppIds).toEqual(ids.slice(0, MAX_OPEN_APPS))
  })

  test('rejects a state that is not the shape it claims', async () => {
    const cases: unknown[] = [
      null,
      { openAppIds: 'weather', focusedAppId: null },
      { openAppIds: [1, 2], focusedAppId: null },
      { openAppIds: [], focusedAppId: 7 }
    ]

    for (const state of cases) {
      // Explicit try/catch rather than `.rejects`: the assertion has to fail when
      // the write *succeeds*, and a matcher that is not actually awaited would
      // pass silently on exactly that case.
      let thrown: unknown = null
      try {
        await writeOpenApps({
          storePath,
          // Deliberately bad input: this is the untrusted renderer's payload.
          state: state as never,
          liveAppIds: ['weather']
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe('Invalid open apps state')
    }
  })
})

describe('readOpenApps', () => {
  test('answers empty when the file is missing', async () => {
    expect(await readOpenApps({ storePath, liveAppIds: ['weather'] })).toEqual({
      openAppIds: [],
      focusedAppId: null
    })
  })

  test('answers empty when the file is corrupt', async () => {
    await writeFile(storePath, '{ not json')
    expect(await readOpenApps({ storePath, liveAppIds: ['weather'] })).toEqual({
      openAppIds: [],
      focusedAppId: null
    })
  })

  test('answers empty when the file parses to the wrong shape', async () => {
    await writeFile(storePath, '[]')
    expect(await readOpenApps({ storePath, liveAppIds: ['weather'] })).toEqual({
      openAppIds: [],
      focusedAppId: null
    })
  })

  test('ignores entries of the wrong type inside a well-formed file', async () => {
    await writeFile(
      storePath,
      JSON.stringify({ openAppIds: ['weather', 42, null, 'notes'], focusedAppId: 'notes' })
    )

    expect(await readOpenApps({ storePath, liveAppIds: ['weather', 'notes'] })).toEqual({
      openAppIds: ['weather', 'notes'],
      focusedAppId: 'notes'
    })
  })
})
