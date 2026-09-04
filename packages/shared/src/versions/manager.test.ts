/**
 * Tests for the version manager's diff.
 *
 * `diff` walked both trees, compared oids, and pushed a path and a type — leaving
 * `oldContent` and `newContent` undefined on every entry. Every consumer that tried
 * to *render* a change therefore got nothing, silently, because a commit that
 * expands to an empty diff looks like a commit with a small one. These tests exist
 * so that cannot happen again unnoticed: the contract is that a diff carries the
 * text, names every changed file, and names no directories.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { VersionManager } from './manager.js'

let dir: string
let manager: VersionManager

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pitaster-versions-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  manager = new VersionManager(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Write a file and commit everything.
 * @param files - Paths relative to the repo, mapped to their contents
 * @param message - The commit message
 * @returns The new commit's oid
 */
async function commit(files: Record<string, string>, message: string): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(dir, path)
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, content, 'utf-8')
    await git.add({ fs, dir, filepath: path })
  }
  return git.commit({
    fs,
    dir,
    message,
    author: { name: 'test', email: 'test@example.com' }
  })
}

describe('diff', () => {
  test('carries the text of both sides', async () => {
    const first = await commit({ 'src/App.tsx': 'const a = 1\n' }, 'first')
    const second = await commit({ 'src/App.tsx': 'const a = 2\n' }, 'second')

    const diffs = await manager.diff(first, second)
    const app = diffs.find((entry) => entry.path === 'src/App.tsx')

    expect(app).toBeDefined()
    expect(app?.type).toBe('modify')
    expect(app?.oldContent).toBe('const a = 1\n')
    expect(app?.newContent).toBe('const a = 2\n')
  })

  test('reports no directories, only files', async () => {
    const first = await commit({ 'README.md': 'one\n' }, 'first')
    const second = await commit({ 'src/deep/nested/file.ts': 'export const x = 1\n' }, 'second')

    const diffs = await manager.diff(first, second)

    expect(diffs.map((entry) => entry.path)).toEqual(['src/deep/nested/file.ts'])
  })

  test('classifies an added file, with no old side', async () => {
    const first = await commit({ 'a.ts': 'a\n' }, 'first')
    const second = await commit({ 'b.ts': 'b\n' }, 'second')

    const added = (await manager.diff(first, second)).find((entry) => entry.path === 'b.ts')

    expect(added?.type).toBe('add')
    expect(added?.oldContent).toBeUndefined()
    expect(added?.newContent).toBe('b\n')
  })

  test('classifies a deleted file, keeping its old text', async () => {
    const first = await commit({ 'gone.ts': 'still here\n' }, 'first')
    await rm(join(dir, 'gone.ts'))
    await git.remove({ fs, dir, filepath: 'gone.ts' })
    const second = await git.commit({
      fs,
      dir,
      message: 'remove',
      author: { name: 'test', email: 'test@example.com' }
    })

    const deleted = (await manager.diff(first, second)).find((entry) => entry.path === 'gone.ts')

    expect(deleted?.type).toBe('delete')
    expect(deleted?.oldContent).toBe('still here\n')
    expect(deleted?.newContent).toBeUndefined()
  })

  test('reports a binary file as changed but carries no text for it', async () => {
    const first = await commit({ 'keep.txt': 'keep\n' }, 'first')
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x01, 0x02]))
    await git.add({ fs, dir, filepath: 'logo.png' })
    const second = await git.commit({
      fs,
      dir,
      message: 'add binary',
      author: { name: 'test', email: 'test@example.com' }
    })

    const binary = (await manager.diff(first, second)).find((entry) => entry.path === 'logo.png')

    // Reported, because it changed; without text, because decoded PNG bytes are
    // noise that would push the real changes out of the view.
    expect(binary).toBeDefined()
    expect(binary?.type).toBe('add')
    expect(binary?.newContent).toBeUndefined()
  })

  test('is empty between a commit and itself', async () => {
    const only = await commit({ 'a.ts': 'a\n' }, 'first')

    expect(await manager.diff(only, only)).toEqual([])
  })
})
