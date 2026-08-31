/**
 * Tests for `replace_lines`.
 *
 * The tool exists to be the attempt that cannot fail on whitespace, so the cases that
 * matter are the ones where a failure would be silent: a range off the end of the file,
 * a CRLF file rewritten with LF, a file's final newline lost.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createFileTools, FILE_TOOL_NAMES, replaceLinesInFile } from './file-tools'

/** The one tool this module exposes. */
const [replaceLines] = createFileTools({ rootPath: '/placeholder' })

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'anyapp-file-tools-'))
})

/**
 * Run `replace_lines` against a file written into a scratch root.
 * @param params - The file's contents and the call's arguments
 * @returns The tool's text output and the file afterwards
 */
async function run(params: {
  content: string
  startLine: number
  endLine: number
  newText: string
}): Promise<{ text: string; after: string }> {
  const path = 'file.ts'
  await writeFile(join(root, path), params.content, 'utf-8')

  return {
    text: await replaceLinesInFile({
      rootPath: root,
      path,
      startLine: params.startLine,
      endLine: params.endLine,
      newText: params.newText
    }),
    after: await readFile(join(root, path), 'utf-8')
  }
}

describe('createFileTools', () => {
  test('exposes exactly the advertised names', () => {
    expect(createFileTools({ rootPath: '/x' }).map((tool) => tool.name)).toEqual([
      ...FILE_TOOL_NAMES
    ])
    expect(replaceLines.name).toBe('replace_lines')
  })
})

describe('replace_lines', () => {
  test('replaces an inclusive range', async () => {
    const { after } = await run({
      content: 'a\nb\nc\n',
      startLine: 2,
      endLine: 2,
      newText: 'B'
    })
    expect(after).toBe('a\nB\nc\n')
  })

  test('replaces one line with several', async () => {
    const { after, text } = await run({
      content: 'a\nb\nc\n',
      startLine: 2,
      endLine: 2,
      newText: 'x\ny'
    })
    expect(after).toBe('a\nx\ny\nc\n')
    // The model's remaining line numbers have moved, and it is told so.
    expect(text).toContain('4 lines')
    expect(text).toContain('shifted')
  })

  test('deletes the range when newText is empty', async () => {
    const { after } = await run({ content: 'a\nb\nc\n', startLine: 2, endLine: 2, newText: '' })
    expect(after).toBe('a\nc\n')
  })

  test('preserves CRLF', async () => {
    const { after } = await run({
      content: 'a\r\nb\r\nc\r\n',
      startLine: 2,
      endLine: 2,
      newText: 'B'
    })
    expect(after).toBe('a\r\nB\r\nc\r\n')
  })

  test('preserves a missing final newline', async () => {
    const { after } = await run({ content: 'a\nb', startLine: 1, endLine: 1, newText: 'A' })
    expect(after).toBe('A\nb')
  })

  test('preserves indentation exactly as given', async () => {
    const { after } = await run({
      content: 'fn() {\n  old\n}\n',
      startLine: 2,
      endLine: 2,
      newText: '\tnew'
    })
    expect(after).toBe('fn() {\n\tnew\n}\n')
  })

  test('refuses a range past the end and names the real line count', async () => {
    const { text, after } = await run({
      content: 'a\nb\n',
      startLine: 1,
      endLine: 9,
      newText: 'x'
    })
    expect(text).toContain('2 lines')
    expect(after).toBe('a\nb\n')
  })

  test('refuses an inverted or zero range', async () => {
    expect((await run({ content: 'a\nb\n', startLine: 2, endLine: 1, newText: 'x' })).text).toContain(
      'invalid range'
    )
    expect((await run({ content: 'a\nb\n', startLine: 0, endLine: 1, newText: 'x' })).text).toContain(
      'invalid range'
    )
  })

  test('refuses a fractional line number', async () => {
    const { text } = await run({ content: 'a\nb\n', startLine: 1.5, endLine: 2, newText: 'x' })
    expect(text).toContain('whole numbers')
  })

  test('reports a no-op rather than pretending it edited', async () => {
    const { text } = await run({ content: 'a\nb\n', startLine: 2, endLine: 2, newText: 'b' })
    expect(text).toContain('No change')
  })

  test('reports a missing file instead of throwing', async () => {
    const text = await replaceLinesInFile({
      rootPath: root,
      path: 'absent.ts',
      startLine: 1,
      endLine: 1,
      newText: 'x'
    })
    expect(text).toContain('could not read')
  })
})
