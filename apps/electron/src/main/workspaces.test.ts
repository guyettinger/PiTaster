/**
 * Tests for the workspace registry, and mostly for one function.
 *
 * `withWorkspace` is the single funnel from a renderer-supplied app id to a
 * confinement root. Every other channel now carries an id, so if this refuses
 * the wrong things once, it refuses them everywhere — and if it accepts the
 * wrong thing once, every channel accepts it. That is the whole reason the
 * funnel exists, and the reason these cases are enumerated rather than sampled.
 *
 * The empty id is the sharpest of them: `join(APPS_DIR, '')` *is* `APPS_DIR`, so
 * an app created that way has every other app inside its root — and `deleteApp`
 * hands that path to a recursive `rm`. No attacker is needed to reach it, only a
 * user naming an app with punctuation.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  MAX_LIVE_HOSTS,
  configureWorkspaces,
  dropAllRuntimes,
  dropRuntime,
  existingRuntime,
  focusedWorkspace,
  getFocusedAppId,
  hostsToEvict,
  setFocusedAppId,
  touchRuntime,
  withWorkspace
} from './workspaces'
import { isValidAppId } from '@keylimepi/shared'
import type { SubApp } from '@keylimepi/core'
import type { AgentHost } from './agent/session'
import type { Telemetry } from './agent/telemetry'

/** A stand-in app, enough for the registry to key on. */
function stubApp(id: string): SubApp {
  return {
    id,
    name: id,
    description: '',
    template: 'blank',
    path: `/tmp/apps/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as SubApp
}

/** Apps the stub lookup knows about. */
const APPS = new Set(['weather', 'notes', 'todo', 'photos', 'notes2', 'chess'])

/** Which apps the tests say are waiting on an approval prompt. */
let prompting = new Set<string>()

beforeEach(() => {
  dropAllRuntimes()
  prompting = new Set()
  configureWorkspaces({
    // Mirrors `AppManager.getApp`: an id that does not name a directory inside
    // the apps root reads as "not found" rather than throwing.
    lookupApp: async (id) =>
      isValidAppId(id) && APPS.has(id) ? stubApp(id) : null,
    createTelemetry: () => ({}) as Telemetry,
    hasPendingApprovals: (id) => prompting.has(id)
  })
})

/**
 * Give a workspace a live host and a position in the eviction order.
 *
 * The host is a stand-in — nothing here calls it. Eviction reads only whether
 * one exists and when it was last used.
 */
async function host(appId: string, usedAt: number): Promise<void> {
  const runtime = await withWorkspace(appId, (workspace) => workspace.runtime)
  runtime.host = {} as AgentHost
  runtime.lastUsedAt = usedAt
}

describe('withWorkspace', () => {
  test('resolves a real app to its root', async () => {
    const root = await withWorkspace('weather', (workspace) => workspace.root)
    expect(root).toBe('/tmp/apps/weather')
  })

  test('reuses one runtime across calls', async () => {
    const first = await withWorkspace('weather', (w) => w.runtime)
    const second = await withWorkspace('weather', (w) => w.runtime)
    expect(second).toBe(first)
  })

  test('keeps runtimes separate per app', async () => {
    const weather = await withWorkspace('weather', (w) => w.runtime)
    const notes = await withWorkspace('notes', (w) => w.runtime)
    expect(notes).not.toBe(weather)

    // The property that makes a per-app permission mode meaningful: changing one
    // workspace's mode must not reach another's in-flight turn.
    weather.permissionMode = 'bypassPermissions'
    expect(notes.permissionMode).toBe('default')
  })

  test('a new workspace starts in the prompting mode', async () => {
    const runtime = await withWorkspace('weather', (w) => w.runtime)
    expect(runtime.permissionMode).toBe('default')
    expect(runtime.host).toBeNull()
    expect(runtime.runActive).toBe(false)
  })

  test('refuses every id that must not become a path', async () => {
    const refused: unknown[] = [
      '', // join(APPS_DIR, '') === APPS_DIR
      '.',
      '..',
      '../..',
      '../../tmp',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'a\0b',
      'weather:stream',
      'x'.repeat(5000),
      null,
      undefined,
      42,
      {},
      [],
      // A well-formed id that names no app is refused too — a valid-looking id
      // is not an app, and answering with an empty workspace would invent one.
      'no-such-app'
    ]

    for (const candidate of refused) {
      let thrown: unknown = null
      try {
        await withWorkspace(candidate, () => 'reached')
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe('Invalid app ID')
    }
  })

  test('does not run the callback for a refused id', async () => {
    let ran = false
    try {
      await withWorkspace('../escape', () => {
        ran = true
      })
    } catch {
      // expected
    }
    expect(ran).toBe(false)
  })

  test('creates no runtime for a refused id', async () => {
    try {
      await withWorkspace('', () => null)
    } catch {
      // expected
    }
    expect(existingRuntime('')).toBeUndefined()
  })
})

describe('focus', () => {
  test('answers the focused workspace', async () => {
    setFocusedAppId('notes')
    expect((await focusedWorkspace())?.id).toBe('notes')
  })

  test('answers null when nothing is focused', async () => {
    setFocusedAppId(null)
    expect(await focusedWorkspace()).toBeNull()
  })

  test('clears focus that no longer names an app', async () => {
    setFocusedAppId('deleted-app')
    expect(await focusedWorkspace()).toBeNull()
    // Not merely a null answer: the stale pointer is dropped, so it cannot be
    // read back as though it were still the focused app.
    expect(getFocusedAppId()).toBeNull()
  })

  test('dropping the focused runtime clears focus', async () => {
    await withWorkspace('weather', () => null)
    setFocusedAppId('weather')
    dropRuntime('weather')
    expect(getFocusedAppId()).toBeNull()
    expect(existingRuntime('weather')).toBeUndefined()
  })
})

describe('hostsToEvict', () => {
  test('evicts nothing while under the cap', async () => {
    await host('weather', 1)
    await host('notes', 2)
    expect(hostsToEvict('todo')).toEqual([])
  })

  test('counts the workspace about to become live', async () => {
    await host('weather', 1)
    await host('notes', 2)
    await host('todo', 3)
    await host('photos', 4)
    // Four hosts and a fifth workspace asking for one: the oldest goes, and the
    // count that decides that has to include the workspace that has not built
    // its host yet — checked after it joins, or the cap is off by one forever.
    expect(hostsToEvict('chess').map((runtime) => runtime.appId)).toEqual(['weather'])
  })

  test('evicts nothing when the asking workspace already has a host', async () => {
    for (const [index, id] of ['weather', 'notes', 'todo', 'photos'].entries()) {
      await host(id, index + 1)
    }
    expect(hostsToEvict('weather')).toEqual([])
  })

  test('never evicts a workspace mid-turn', async () => {
    for (const [index, id] of ['weather', 'notes', 'todo', 'photos'].entries()) {
      await host(id, index + 1)
    }
    const oldest = existingRuntime('weather')
    if (oldest) oldest.runActive = true
    // Killing a background turn because someone opened another app is a new
    // failure mode, not a cap being enforced.
    expect(hostsToEvict('chess').map((runtime) => runtime.appId)).toEqual(['notes'])
  })

  test('never evicts a workspace holding an approval prompt', async () => {
    for (const [index, id] of ['weather', 'notes', 'todo', 'photos'].entries()) {
      await host(id, index + 1)
    }
    prompting.add('weather')
    // The user is looking at the question. Disposing the host would resolve
    // their answer into a session that no longer exists.
    expect(hostsToEvict('chess').map((runtime) => runtime.appId)).toEqual(['notes'])
  })

  test('never evicts the workspace on screen', async () => {
    for (const [index, id] of ['weather', 'notes', 'todo', 'photos'].entries()) {
      await host(id, index + 1)
    }
    setFocusedAppId('weather')
    expect(hostsToEvict('chess').map((runtime) => runtime.appId)).toEqual(['notes'])
  })

  test('ignores runtimes that hold no host', async () => {
    // Every app-addressed channel creates a runtime, so most of them have none.
    // Counting those would evict a live conversation because a file was read
    // from the Apps page.
    for (const id of ['weather', 'notes', 'todo', 'photos', 'chess']) {
      await withWorkspace(id, () => null)
    }
    await host('weather', 1)
    expect(hostsToEvict('notes2')).toEqual([])
  })

  test('evicts oldest first, and only as many as the cap requires', async () => {
    const ids = ['weather', 'notes', 'todo', 'photos', 'chess', 'notes2']
    for (const [index, id] of ids.entries()) {
      await host(id, index + 1)
    }
    // Six live hosts against a cap of four, with a seventh workspace asking:
    // three must go, oldest first.
    expect(hostsToEvict('unknown-but-unbuilt')).toHaveLength(ids.length + 1 - MAX_LIVE_HOSTS)
    expect(hostsToEvict(null).map((runtime) => runtime.appId)).toEqual([
      'weather',
      'notes'
    ])
  })

  test('touching a runtime moves it out of the firing line', async () => {
    for (const [index, id] of ['weather', 'notes', 'todo', 'photos'].entries()) {
      await host(id, index + 1)
    }
    const oldest = existingRuntime('weather')
    if (oldest) touchRuntime(oldest)
    expect(hostsToEvict('chess').map((runtime) => runtime.appId)).toEqual(['notes'])
  })

  test('a new runtime is not stale and has no host', async () => {
    const runtime = await withWorkspace('weather', (workspace) => workspace.runtime)
    expect(runtime.hostStale).toBe(false)
    expect(runtime.lastUsedAt).toBeGreaterThan(0)
  })
})
