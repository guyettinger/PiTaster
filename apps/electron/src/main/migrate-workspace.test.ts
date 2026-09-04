/**
 * Tests for the anyapp → Pi Taster workspace migration.
 *
 * This is the one piece of the rebrand that touches data the user owns and cannot
 * regenerate — their sub-apps, the git history inside each one, their transcripts and
 * skills. The properties that matter are therefore about restraint as much as about
 * the move: it runs once, it is a no-op every launch after, and it never folds a
 * legacy directory into a workspace that already exists, because that could overwrite
 * a config or an app currently in use.
 *
 * The metadata rename is tested against a real isomorphic-git repository rather than
 * a fixture, because the property under test is precisely that the rename is
 * *committed* — a rename that left the file uncommitted would leave every migrated
 * app permanently dirty and put a deletion the user never made in front of their next
 * rollback.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { migrateWorkspace } from './migrate-workspace'

let scratch: string
let legacyRoot: string
let root: string

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pitaster-migrate-'))
  legacyRoot = join(scratch, '.anyapp')
  root = join(scratch, '.pitaster')
})

/** Whether a path exists, for assertions. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Builds a sub-app under a workspace root, with a git repo and a committed
 * pre-rebrand metadata file — the shape every existing install has on disk.
 *
 * @param params - Which workspace root to build under, and the app's id
 * @returns The app's absolute path
 */
async function seedLegacyApp(params: { under: string; id: string }): Promise<string> {
  const appPath = join(params.under, 'apps', params.id)
  await mkdir(appPath, { recursive: true })
  await writeFile(join(appPath, '.anyapp-meta.json'), JSON.stringify({ id: params.id }))
  await writeFile(join(appPath, 'index.ts'), 'export const value = 1\n')

  await git.init({ fs, dir: appPath, defaultBranch: 'main' })
  await git.add({ fs, dir: appPath, filepath: '.anyapp-meta.json' })
  await git.add({ fs, dir: appPath, filepath: 'index.ts' })
  await git.commit({
    fs,
    dir: appPath,
    message: 'initial',
    author: { name: 'Test', email: 'test@example.com' }
  })

  return appPath
}

/** Paths git reports as differing between HEAD, the worktree and the index. */
async function dirtyPaths(dir: string): Promise<string[]> {
  const matrix = await git.statusMatrix({ fs, dir })
  return matrix
    .filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
    .map(([path]) => path)
}

describe('migrateWorkspace', () => {
  test('moves the workspace directory and reports it', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"qwen"}')

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.movedWorkspace).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"qwen"}')
  })

  test('is a no-op on the second run', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{}')

    await migrateWorkspace({ legacyRoot, root })
    const second = await migrateWorkspace({ legacyRoot, root })

    expect(second.movedWorkspace).toBe(false)
    expect(second.migratedApps).toEqual([])
  })

  test('does nothing on a fresh install where neither root exists', async () => {
    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.movedWorkspace).toBe(false)
    expect(await exists(root)).toBe(false)
  })

  test('never overwrites a file the destination already has', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'config.json'), '{"model":"current"}')
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"stale"}')
    await writeFile(join(legacyRoot, 'layouts.json'), '{"a":1}')

    await migrateWorkspace({ legacyRoot, root })

    // The live config wins; the gap beside it is filled.
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"current"}')
    expect(await readFile(join(root, 'layouts.json'), 'utf-8')).toBe('{"a":1}')
    // The legacy root survives, because it still holds the file that was not moved.
    expect(await exists(join(legacyRoot, 'config.json'))).toBe(true)
  })

  test('migrates into an empty destination left behind by something else', async () => {
    // The case that actually bit: a stray `~/.pitaster/apps` is enough to create the
    // destination, and a migration keyed on mere existence would strand the real
    // workspace next door — the app opening with no apps, history or settings.
    await mkdir(join(root, 'apps'), { recursive: true })
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"qwen"}')

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.movedWorkspace).toBe(true)
    expect(result.migratedApps).toEqual(['weather'])
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"qwen"}')
    expect(await exists(join(root, 'apps', 'weather', '.pitaster-meta.json'))).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
  })

  test('merges an apps directory that exists on both sides', async () => {
    await seedLegacyApp({ under: root, id: 'already-here' })
    await seedLegacyApp({ under: legacyRoot, id: 'incoming' })

    await migrateWorkspace({ legacyRoot, root })

    expect(await exists(join(root, 'apps', 'already-here'))).toBe(true)
    expect(await exists(join(root, 'apps', 'incoming'))).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
  })

  test("renames each app's metadata file and commits the rename", async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.migratedApps).toEqual(['weather'])

    const appPath = join(root, 'apps', 'weather')
    expect(await exists(join(appPath, '.pitaster-meta.json'))).toBe(true)
    expect(await exists(join(appPath, '.anyapp-meta.json'))).toBe(false)

    // The whole point of committing: the app must not be left dirty.
    expect(await dirtyPaths(appPath)).toEqual([])

    const log = await git.log({ fs, dir: appPath })
    expect(log[0].commit.message).toContain('Pi Taster rebrand')
    expect(log[0].commit.author.name).toBe('Pi Taster Agent')
  })

  test('migrates every app, and leaves already-migrated ones alone', async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })
    await seedLegacyApp({ under: legacyRoot, id: 'notes' })

    const first = await migrateWorkspace({ legacyRoot, root })
    expect(first.migratedApps.sort()).toEqual(['notes', 'weather'])

    // A second pass finds nothing to do and adds no further commits.
    const before = await git.log({ fs, dir: join(root, 'apps', 'weather') })
    const second = await migrateWorkspace({ legacyRoot, root })
    const after = await git.log({ fs, dir: join(root, 'apps', 'weather') })

    expect(second.migratedApps).toEqual([])
    expect(after.length).toBe(before.length)
  })

  test('finishes the app pass when an earlier run moved the directory but stopped', async () => {
    // An interrupted migration: the directory is already at its new name, but an app
    // inside it still carries the pre-rebrand metadata file.
    await seedLegacyApp({ under: root, id: 'weather' })

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.movedWorkspace).toBe(false)
    expect(result.migratedApps).toEqual(['weather'])
    expect(await exists(join(root, 'apps', 'weather', '.pitaster-meta.json'))).toBe(true)
  })

  test('still renames the metadata file when the app has no git repository', async () => {
    const appPath = join(legacyRoot, 'apps', 'bare')
    await mkdir(appPath, { recursive: true })
    await writeFile(join(appPath, '.anyapp-meta.json'), '{"id":"bare"}')

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.migratedApps).toEqual(['bare'])
    expect(await exists(join(root, 'apps', 'bare', '.pitaster-meta.json'))).toBe(true)
  })

  test('tolerates a workspace with no apps directory', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{}')

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.movedWorkspace).toBe(true)
    expect(result.migratedApps).toEqual([])
  })

  test('leaves a non-app entry under apps/ alone', async () => {
    await mkdir(join(legacyRoot, 'apps', 'not-an-app'), { recursive: true })
    await writeFile(join(legacyRoot, 'apps', 'not-an-app', 'stray.txt'), 'hello')

    const result = await migrateWorkspace({ legacyRoot, root })

    expect(result.migratedApps).toEqual([])
    expect(await exists(join(root, 'apps', 'not-an-app', 'stray.txt'))).toBe(true)
  })
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})
