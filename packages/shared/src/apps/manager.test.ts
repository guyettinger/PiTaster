/**
 * Tests for sub-app id validation.
 *
 * An app id becomes `SubApp.path`, which is the root `permission-gate.ts` measures
 * every tool argument against and the path `deleteApp` hands to a recursive `rm`. The
 * two cases that motivated these are the first and the last: `join` resolves a
 * traversing id outside the apps directory without complaint, and `generateId` reduces
 * a name with no alphanumerics to the empty string, which `join` resolves to the apps
 * directory itself.
 */

import { describe, expect, test } from 'bun:test'
import { AppManager, isValidAppId } from './manager.js'
import { getAppPath } from '../chat/session-paths.js'

describe('isValidAppId', () => {
  test('accepts the ids generateId produces', () => {
    const manager = new AppManager()

    for (const name of ['Magic 8 Ball', 'Pony Pony Pony', 'app', 'a-b-c-123']) {
      expect(isValidAppId(manager.generateId(name))).toBe(true)
    }
  })

  test('accepts ids an older generateId may have written', () => {
    // Deliberately permissive about characters. A stricter rule would make an existing
    // app on disk vanish from the listing rather than close a hole.
    for (const id of ['My_App', 'App.v2', 'ünïcode', 'UPPER']) {
      expect(isValidAppId(id)).toBe(true)
    }
  })

  test('refuses anything that is not one path segment', () => {
    for (const id of [
      '../../../tmp/evil',
      '..',
      '.',
      'a/b',
      'a\\b',
      '/etc',
      '/Users/someone/.ssh',
      'app\0.txt',
      // Windows alternate data stream. Contained, but not a directory name.
      'cache:bin'
    ]) {
      expect(isValidAppId(id)).toBe(false)
    }
  })

  test('refuses the empty id', () => {
    // `join(APPS_DIR, '')` is `APPS_DIR`. An app created with this id has every other
    // app inside its root, and deleting it would remove all of them.
    expect(isValidAppId('')).toBe(false)
  })
})

describe('AppManager.getApp', () => {
  test('reports a traversing id as not found rather than reading it', async () => {
    const manager = new AppManager()

    // `~/.keylimepi` is a real directory one level above the apps root. Before the id was
    // validated, this resolved there and only failed for want of a metadata file.
    expect(await manager.getApp('..')).toBeNull()
    expect(await manager.getApp('../../..')).toBeNull()
    expect(await manager.getApp('')).toBeNull()
    expect(await manager.getApp('/etc')).toBeNull()
  })

  test('still reports a well-formed id for a missing app as not found', async () => {
    // The other half of the contract. Validation must not turn "no such app" into a
    // throw, because every mutating method distinguishes the two by this null.
    expect(await new AppManager().getApp('no-such-app-abc123')).toBeNull()
  })
})

describe('AppManager.deleteApp', () => {
  test('refuses an id that does not name an app rather than removing a directory', async () => {
    const manager = new AppManager()

    // This is the sharp end: `deleteApp` passes `app.path` to
    // `rm(path, { recursive: true, force: true })`. `''` is the case that needs no
    // attacker — it used to resolve to the apps root, taking every app with it.
    for (const id of ['..', '../../..', '', '/etc']) {
      await expect(manager.deleteApp(id)).rejects.toThrow(/not found/)
    }
  })
})

describe('getAppPath', () => {
  test('refuses the same ids AppManager does', () => {
    // A second id-to-path join, and not a read-only one: `ChatHistoryManager` calls
    // `mkdir -p` on this path and writes into it.
    for (const id of ['..', '../../..', '', '/etc', 'a/b']) {
      expect(() => getAppPath(id)).toThrow(/Invalid app ID/)
    }
  })

  test('resolves a real id inside the apps root', () => {
    expect(getAppPath('magic-8-ball')).toMatch(/[/\\]\.keylimepi[/\\]apps[/\\]magic-8-ball$/)
  })
})

describe('AppManager.createApp', () => {
  test('refuses a name that cannot produce a folder name', async () => {
    const manager = new AppManager()

    // `generateId` strips everything but [a-z0-9-], so these all reduce to ''.
    for (const name of ['!!!', '...', '   ']) {
      expect(manager.generateId(name)).toBe('')
      await expect(
        manager.createApp({ name, description: '', template: 'react-vite' })
      ).rejects.toThrow(/letters or digits/)
    }
  })
})
