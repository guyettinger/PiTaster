/**
 * Tests for line-level file handling.
 *
 * The round-trip cases matter more than they look: `replace_lines` and the edit-repair
 * hook both go through here, and a decomposition that does not rebuild byte-for-byte
 * would rewrite line endings or add a blank line on every edit.
 */

import { describe, expect, test } from 'bun:test'
import {
  normalizeForShapeMatch,
  numberLines,
  parseFileText,
  renderFileText
} from './file-lines'

describe('parseFileText and renderFileText', () => {
  const roundTrips = [
    ['empty', ''],
    ['one line, no newline', 'a'],
    ['one line, trailing newline', 'a\n'],
    ['two lines', 'a\nb\n'],
    ['no trailing newline', 'a\nb'],
    ['a trailing blank line', 'a\n\n'],
    ['just a newline', '\n'],
    ['crlf', 'a\r\nb\r\n'],
    ['crlf, no trailing newline', 'a\r\nb']
  ] as const

  for (const [name, content] of roundTrips) {
    test(`round-trips ${name}`, () => {
      expect(renderFileText(parseFileText(content))).toBe(content)
    })
  }

  test('does not glue a CRLF terminator onto the last line', () => {
    expect(parseFileText('a\r\nb\r\n').lines).toEqual(['a', 'b'])
  })

  test('detects the line ending', () => {
    expect(parseFileText('a\r\nb').lineEnding).toBe('\r\n')
    expect(parseFileText('a\nb').lineEnding).toBe('\n')
  })

  test('does not invent a phantom final line', () => {
    expect(parseFileText('a\nb\n').lines).toHaveLength(2)
  })
})

describe('numberLines', () => {
  test('numbers from the given start and keeps indentation', () => {
    // Padded to the width of the largest number, so 9 becomes ' 9'.
    expect(numberLines({ lines: ['a', '  b'], startLine: 9 })).toBe(' 9 | a\n10 |   b')
  })

  test('right-aligns so the pipes line up', () => {
    const rendered = numberLines({ lines: ['a', 'b'], startLine: 9 }).split('\n')
    expect(rendered[0].indexOf('|')).toBe(rendered[1].indexOf('|'))
  })
})

describe('normalizeForShapeMatch', () => {
  test('ignores indentation and collapses internal runs', () => {
    expect(normalizeForShapeMatch('    const  x =  1')).toBe(normalizeForShapeMatch('const x = 1'))
  })

  test('does not equate different code', () => {
    expect(normalizeForShapeMatch('const x = 1')).not.toBe(normalizeForShapeMatch('const y = 1'))
  })
})
