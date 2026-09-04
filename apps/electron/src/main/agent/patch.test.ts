/**
 * Tests for the diffs shown in the transcript and the approval prompt.
 *
 * The approval preview is the part worth being strict about. It is shown to a person
 * who then takes responsibility for the change, so the property under test is not
 * "produces a nice diff" but **accurate or absent**: every case where Pi Taster cannot know
 * exactly what a write will do must return nothing rather than a plausible guess.
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { buildPatch, createPatchRecorder, previewPatch } from './patch'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pitaster-patch-'))
})

/**
 * Write a fixture file.
 * @param name - Its name in the scratch root
 * @param content - Its contents
 */
async function write(name: string, content: string): Promise<void> {
  await writeFile(join(root, name), content, 'utf-8')
}

/**
 * Preview a pending call against the scratch root.
 * @param toolName - The tool about to run
 * @param input - Its arguments
 * @returns The projected patches
 */
function preview(toolName: string, input: Record<string, unknown>) {
  return previewPatch({ rootPath: root, toolName, input })
}

describe('buildPatch', () => {
  test('returns nothing when the text did not change', () => {
    expect(buildPatch({ path: 'a.ts', before: 'same\n', after: 'same\n' })).toBeNull()
  })

  test('counts added and removed lines', () => {
    const patch = buildPatch({ path: 'a.ts', before: 'one\ntwo\n', after: 'one\ntwo\nthree\n' })!

    expect(patch.added).toBe(1)
    expect(patch.removed).toBe(0)
    expect(patch.path).toBe('a.ts')
    expect(patch.truncated).toBe(false)
  })

  test('renders a new file as all additions', () => {
    const patch = buildPatch({ path: 'a.ts', before: '', after: 'one\ntwo\n' })!

    expect(patch.added).toBe(2)
    expect(patch.removed).toBe(0)
  })

  test('drops the header that repeats the filename the UI already shows', () => {
    const patch = buildPatch({ path: 'a.ts', before: 'one\n', after: 'two\n' })!

    expect(patch.patch).not.toContain('Index:')
    expect(patch.patch).not.toContain('+++')
    expect(patch.patch).toContain('@@')
  })

  test('truncates a very large diff and says so', () => {
    const before = ''
    const after = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join('\n')

    const patch = buildPatch({ path: 'a.ts', before, after })!

    expect(patch.truncated).toBe(true)
    expect(patch.patch).toContain('more lines')
    expect(patch.patch.split('\n').length).toBeLessThan(410)
  })
})

describe('createPatchRecorder', () => {
  test('diffs a file against what it recorded', async () => {
    await write('a.ts', 'one\n')
    const recorder = createPatchRecorder({ rootPath: root })

    await recorder.record({ toolCallId: 'c1', path: 'a.ts' })
    await write('a.ts', 'one\ntwo\n')
    const patch = await recorder.complete({ toolCallId: 'c1', path: 'a.ts' })

    expect(patch?.added).toBe(1)
  })

  test('returns nothing for a call it never recorded', async () => {
    await write('a.ts', 'one\n')

    expect(
      await createPatchRecorder({ rootPath: root }).complete({ toolCallId: 'c9', path: 'a.ts' })
    ).toBeNull()
  })

  test('does not reuse a recording across two calls', async () => {
    await write('a.ts', 'one\n')
    const recorder = createPatchRecorder({ rootPath: root })

    await recorder.record({ toolCallId: 'c1', path: 'a.ts' })
    await write('a.ts', 'one\ntwo\n')
    await recorder.complete({ toolCallId: 'c1', path: 'a.ts' })

    expect(await recorder.complete({ toolCallId: 'c1', path: 'a.ts' })).toBeNull()
  })

  test('forget drops a recording for a call that never ran', async () => {
    await write('a.ts', 'one\n')
    const recorder = createPatchRecorder({ rootPath: root })

    await recorder.record({ toolCallId: 'c1', path: 'a.ts' })
    recorder.forget('c1')

    expect(await recorder.complete({ toolCallId: 'c1', path: 'a.ts' })).toBeNull()
  })
})

describe('previewPatch — exact where it can be', () => {
  test('write previews the whole new file', async () => {
    await write('a.ts', 'one\n')

    const [patch] = await preview('write', { path: 'a.ts', content: 'one\ntwo\n' })

    expect(patch!.added).toBe(1)
  })

  test('write previews a file that does not exist yet', async () => {
    const [patch] = await preview('write', { path: 'new.ts', content: 'hello\n' })

    expect(patch!.added).toBe(1)
    expect(patch!.removed).toBe(0)
  })

  test('replace_lines previews the exact range', async () => {
    await write('a.ts', 'one\ntwo\nthree\n')

    const [patch] = await preview('replace_lines', {
      path: 'a.ts',
      startLine: 2,
      endLine: 2,
      newText: 'TWO'
    })

    expect(patch!.patch).toContain('-two')
    expect(patch!.patch).toContain('+TWO')
  })

  test('edit previews a replacement that matches exactly and uniquely', async () => {
    await write('a.ts', 'const a = 1\nconst b = 2\n')

    const [patch] = await preview('edit', {
      path: 'a.ts',
      edits: [{ oldText: 'const b = 2', newText: 'const b = 3' }]
    })

    expect(patch!.patch).toContain('+const b = 3')
  })

  test('edit applies several replacements in one preview', async () => {
    await write('a.ts', 'one\ntwo\nthree\n')

    const [patch] = await preview('edit', {
      path: 'a.ts',
      edits: [
        { oldText: 'one', newText: 'ONE' },
        { oldText: 'three', newText: 'THREE' }
      ]
    })

    expect(patch!.patch).toContain('+ONE')
    expect(patch!.patch).toContain('+THREE')
  })
})

describe('previewPatch — absent rather than wrong', () => {
  test('says nothing when an edit’s text is not in the file', async () => {
    await write('a.ts', 'const a = 1\n')

    // Pi's matcher may still land this through its fuzzy fallback. Pi Taster does not
    // reimplement that fallback, so it shows nothing rather than a diff that might not
    // be the one about to be approved.
    expect(await preview('edit', { path: 'a.ts', edits: [{ oldText: '  const a = 1', newText: 'x' }] })).toEqual([])
  })

  test('says nothing when an edit’s text is ambiguous', async () => {
    await write('a.ts', 'dup\ndup\n')

    // Pi requires each `oldText` to be unique and refuses the edit otherwise, so there
    // is no single outcome to preview.
    expect(await preview('edit', { path: 'a.ts', edits: [{ oldText: 'dup', newText: 'x' }] })).toEqual([])
  })

  test('says nothing for a replace_lines range off the end of the file', async () => {
    await write('a.ts', 'one\n')

    expect(
      await preview('replace_lines', { path: 'a.ts', startLine: 5, endLine: 9, newText: 'x' })
    ).toEqual([])
  })

  test('says nothing for bash, which changes something it cannot read', async () => {
    expect(await preview('bash', { command: 'rm -rf build' })).toEqual([])
  })

  test('says nothing for a tool with no path', async () => {
    expect(await preview('write', { content: 'orphaned' })).toEqual([])
  })

  test('says nothing when the write would change nothing', async () => {
    await write('a.ts', 'same\n')

    expect(await preview('write', { path: 'a.ts', content: 'same\n' })).toEqual([])
  })
})
