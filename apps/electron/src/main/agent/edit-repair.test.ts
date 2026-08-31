/**
 * Tests for edit repair.
 *
 * The behaviour under test is not "produces a message" but "produces the text the model
 * needs to succeed on the next attempt": the real region, with its real indentation, at
 * a line number `replace_lines` will accept.
 */

import { describe, expect, test } from 'bun:test'
import { classifyEditFailure, createEditRepair } from './edit-repair'

/** A file whose indentation is what a model gets wrong. */
const FILE = [
  'export function Counter(): JSX.Element {',
  '  const [count, setCount] = useState(0)',
  '',
  '  return <button onClick={() => setCount(count + 1)}>{count}</button>',
  '}',
  ''
].join('\n')

const NOT_FOUND =
  'Could not find the exact text in src/Counter.tsx. The old text must match exactly including all whitespace and newlines.'

/**
 * Build a repair tracker over a fixed in-memory file.
 * @param content - The file the repair should read
 * @returns The tracker
 */
function repairOver(content: string) {
  return createEditRepair({
    rootPath: '/app',
    maxQuoteTokens: 500,
    readTextFile: async () => content
  })
}

describe('classifyEditFailure', () => {
  test('recognises both wordings of the not-found failure', () => {
    expect(classifyEditFailure(NOT_FOUND)).toBe('notFound')
    expect(
      classifyEditFailure('Could not find edits[2] in a.ts. The oldText must match exactly.')
    ).toBe('notFound')
  })

  test('recognises the other failures Pi produces', () => {
    expect(classifyEditFailure('Found 3 occurrences of the text in a.ts.')).toBe('duplicate')
    expect(classifyEditFailure('No changes made to a.ts.')).toBe('noChange')
    expect(classifyEditFailure('edits[0] and edits[1] overlap in a.ts.')).toBe('overlap')
    expect(classifyEditFailure('edits[0].oldText must not be empty in a.ts.')).toBe('empty')
  })

  test('does not classify an unrelated failure', () => {
    expect(classifyEditFailure('Could not edit file: a.ts. Error code: ENOENT.')).toBe('other')
  })
})

describe('createEditRepair', () => {
  test('quotes the real region when only the indentation was wrong', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: {
        path: 'src/Counter.tsx',
        // The model dropped the two-space indent.
        edits: [{ oldText: 'const [count, setCount] = useState(0)', newText: 'const [count, setCount] = useState(1)' }]
      },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text).toBeDefined()
    expect(outcome.text).toContain('lines 2-2')
    expect(outcome.text).toContain('indentation differs')
    // The quoted region carries the indentation the model failed to reproduce.
    expect(outcome.text).toContain('2 |   const [count, setCount] = useState(0)')
    // And the line numbers replace_lines would take.
    expect(outcome.text).toContain('startLine=2')
  })

  test('matches a multi-line region across a blank-line difference', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: {
        path: 'src/Counter.tsx',
        edits: [
          {
            oldText: 'const [count, setCount] = useState(0)\nreturn <button onClick={() => setCount(count + 1)}>{count}</button>',
            newText: 'x'
          }
        ]
      },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text).toContain('lines 2-4')
  })

  test('says the text is absent when nothing matches even loosely', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: {
        path: 'src/Counter.tsx',
        edits: [{ oldText: 'const nothingLikeThis = true', newText: 'x' }]
      },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text).toContain('No part of')
    expect(outcome.text).toContain('5 lines')
    expect(outcome.text).toContain('Read it again')
  })

  test('names the lines a duplicate anchor matched', async () => {
    const repair = repairOver(['a', 'dup', 'b', 'dup', 'c', ''].join('\n'))
    const outcome = await repair.repair({
      input: { path: 'a.ts', edits: [{ oldText: 'dup', newText: 'x' }] },
      resultText: 'Found 2 occurrences of the text in a.ts. The text must be unique.',
      isError: true
    })

    expect(outcome.text).toContain('lines 2, 4')
    expect(outcome.text).toContain('replace_lines')
  })

  test('uses the edits[] index the message blames', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: {
        path: 'src/Counter.tsx',
        edits: [
          { oldText: 'export function Counter(): JSX.Element {', newText: 'x' },
          { oldText: 'const [count, setCount] = useState(0)', newText: 'y' }
        ]
      },
      resultText: 'Could not find edits[1] in src/Counter.tsx. The oldText must match exactly.',
      isError: true
    })

    expect(outcome.text).toContain('lines 2-2')
  })

  test('accepts the legacy single-edit input shape', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: {
        path: 'src/Counter.tsx',
        oldText: 'const [count, setCount] = useState(0)',
        newText: 'z'
      },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text).toContain('lines 2-2')
  })

  test('leaves a successful edit alone', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: { path: 'src/Counter.tsx', edits: [] },
      resultText: 'Successfully replaced 1 block(s) in src/Counter.tsx.',
      isError: false
    })

    expect(outcome.text).toBeUndefined()
  })

  test('leaves an unclassifiable failure alone', async () => {
    const repair = repairOver(FILE)
    const outcome = await repair.repair({
      input: { path: 'src/Counter.tsx', edits: [{ oldText: 'a', newText: 'b' }] },
      resultText: 'Could not edit file: src/Counter.tsx. Error code: EACCES.',
      isError: true
    })

    expect(outcome.text).toBeUndefined()
  })

  test('escalates on the third consecutive failure on one path', async () => {
    const repair = repairOver(FILE)
    const call = () =>
      repair.repair({
        input: { path: 'src/Counter.tsx', edits: [{ oldText: 'const nope = 1', newText: 'x' }] },
        resultText: NOT_FOUND,
        isError: true
      })

    expect((await call()).text).not.toContain('failure 3 in a row')
    expect((await call()).text).not.toContain('failure 3 in a row')

    const third = await call()
    expect(third.text).toContain('failure 3 in a row')
    expect(third.text).toContain('replace_lines')
    expect(third.text).toContain('write')
  })

  test('counts failures per path, not globally', async () => {
    const repair = repairOver(FILE)
    const failOn = (path: string) =>
      repair.repair({
        input: { path, edits: [{ oldText: 'const nope = 1', newText: 'x' }] },
        resultText: NOT_FOUND,
        isError: true
      })

    await failOn('a.ts')
    await failOn('b.ts')
    expect((await failOn('a.ts')).text).not.toContain('in a row')
  })

  test('a success clears the streak for that path', async () => {
    const repair = repairOver(FILE)
    const fail = () =>
      repair.repair({
        input: { path: 'a.ts', edits: [{ oldText: 'const nope = 1', newText: 'x' }] },
        resultText: NOT_FOUND,
        isError: true
      })

    await fail()
    await fail()
    await repair.repair({ input: { path: 'a.ts' }, resultText: 'ok', isError: false })
    expect((await fail()).text).not.toContain('in a row')
  })

  test('reset clears every streak, as a new prompt should', async () => {
    const repair = repairOver(FILE)
    const fail = () =>
      repair.repair({
        input: { path: 'a.ts', edits: [{ oldText: 'const nope = 1', newText: 'x' }] },
        resultText: NOT_FOUND,
        isError: true
      })

    await fail()
    await fail()
    repair.reset()
    expect((await fail()).text).not.toContain('in a row')
  })

  test('bounds the quoted region rather than pasting a whole file', async () => {
    const long = Array.from({ length: 400 }, (_, index) => `  line ${index}`).join('\n')
    const repair = createEditRepair({
      rootPath: '/app',
      maxQuoteTokens: 30,
      readTextFile: async () => long
    })

    const outcome = await repair.repair({
      input: {
        path: 'a.ts',
        edits: [{ oldText: long.split('\n').map((line) => line.trim()).join('\n'), newText: 'x' }]
      },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text!.length).toBeLessThan(long.length)
    expect(outcome.text).toContain('re-read from offset')
  })

  test('leaves the result alone when the file cannot be read', async () => {
    const repair = createEditRepair({
      rootPath: '/app',
      maxQuoteTokens: 500,
      readTextFile: async () => {
        throw new Error('ENOENT')
      }
    })

    const outcome = await repair.repair({
      input: { path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }] },
      resultText: NOT_FOUND,
      isError: true
    })

    expect(outcome.text).toBeUndefined()
  })
})
