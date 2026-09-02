/**
 * Tests for the renderer's file access.
 *
 * The property under test is confinement, and the case worth being explicit about is the
 * one a security review surfaced: `isWithinRoot` only ever means "inside whatever string
 * the caller called the root", so these functions are safe exactly as far as their
 * `rootPath` is trusted. `resolveAppRoot` in `ipc.ts` is what establishes that; these
 * tests cover the half that lives here.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { listAppFiles, readAppFile } from './files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'anyapp-files-'))
})

/**
 * Write a fixture file, creating its directory.
 * @param path - Path relative to the scratch root
 * @param content - The file's contents
 */
async function write(path: string, content: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf-8')
}

describe('readAppFile', () => {
  test('reads a file inside the root', async () => {
    await write('src/App.tsx', 'export const App = () => null\n')

    const file = await readAppFile({ rootPath: root, path: 'src/App.tsx' })

    expect(file.path).toBe('src/App.tsx')
    expect(file.text).toContain('export const App')
  })

  test('refuses a path that climbs out of the root', async () => {
    await write('src/App.tsx', 'x')

    expect(readAppFile({ rootPath: root, path: '../../../etc/passwd' })).rejects.toThrow(
      'outside the app'
    )
  })

  test('refuses an absolute path outside the root', async () => {
    expect(readAppFile({ rootPath: root, path: '/etc/passwd' })).rejects.toThrow(
      'outside the app'
    )
  })

  test('refuses a directory', async () => {
    await write('src/App.tsx', 'x')

    expect(readAppFile({ rootPath: root, path: 'src' })).rejects.toThrow('not a file')
  })
})

describe('listAppFiles', () => {
  test('lists sources, directories first then alphabetically', async () => {
    await write('src/App.tsx', 'x')
    await write('package.json', '{}')

    const nodes = await listAppFiles(root)

    expect(nodes.map((node) => node.name)).toEqual(['src', 'package.json'])
    expect(nodes[0]!.children?.[0]!.path).toBe('src/App.tsx')
  })

  test('hides node_modules and build output', async () => {
    await write('node_modules/react/index.js', 'x')
    await write('dist/bundle.js', 'x')
    await write('src/App.tsx', 'x')

    // Not tidiness. A sub-app that has run `install_deps` holds tens of thousands of
    // files, and walking them would hang the panel on something nobody wants to browse.
    expect((await listAppFiles(root)).map((node) => node.name)).toEqual(['src'])
  })

  test('shows .gitignore but not other dotfiles', async () => {
    await write('.gitignore', 'node_modules/')
    await write('.env', 'SECRET=1')
    await write('src/App.tsx', 'x')

    const names = (await listAppFiles(root)).map((node) => node.name)

    expect(names).toContain('.gitignore')
    expect(names).not.toContain('.env')
  })
})
