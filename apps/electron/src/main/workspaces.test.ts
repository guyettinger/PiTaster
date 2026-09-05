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
  configureWorkspaces,
  dropAllRuntimes,
  dropRuntime,
  existingRuntime,
  focusedWorkspace,
  getFocusedAppId,
  setFocusedAppId,
  withWorkspace
} from './workspaces'
import { isValidAppId } from '@pitaster/shared'
import type { SubApp } from '@pitaster/core'
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
const APPS = new Set(['weather', 'notes'])

beforeEach(() => {
  dropAllRuntimes()
  configureWorkspaces({
    // Mirrors `AppManager.getApp`: an id that does not name a directory inside
    // the apps root reads as "not found" rather than throwing.
    lookupApp: async (id) =>
      isValidAppId(id) && APPS.has(id) ? stubApp(id) : null,
    createTelemetry: () => ({}) as Telemetry
  })
})

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
