/**
 * Tests for the changed-files strip's list building.
 *
 * Three sources know a file changed and they overlap, so the property under test
 * is that each file appears exactly once and under the source that knows the most
 * about it. Getting that wrong is not cosmetic: the strip leads with a file count,
 * and a path counted twice makes the strip lie about how much the agent touched.
 *
 * The component itself is not tested here — these tests have no DOM.
 */

import { describe, expect, test } from 'bun:test'
import { collectChangedFiles } from './ChangedFilesStrip'
import type { FilePatch } from '@anyapp/core'

/**
 * A patch fixture.
 * @param path - The file's path
 * @param added - Lines added
 * @param removed - Lines removed
 * @returns A patch with a plausible body
 */
function patch(path: string, added: number, removed: number): FilePatch {
  return { path, patch: `@@ -1,1 +1,1 @@\n-old\n+new\n`, added, removed, truncated: false }
}

/**
 * Call the collector with `committedPaths` defaulting to the paths that have
 * patches, which is the ordinary case — the two lists differ only when a file
 * changed without producing text to diff.
 * @param options - The sources, with `committedPaths` optional
 * @returns The collected files
 */
function collect(options: {
  patches: FilePatch[]
  committedPaths?: string[]
  uncommitted: string[]
  pendingPaths: string[]
}): ReturnType<typeof collectChangedFiles> {
  return collectChangedFiles({
    ...options,
    committedPaths: options.committedPaths ?? options.patches.map((entry) => entry.path)
  })
}

describe('collectChangedFiles', () => {
  test('is empty when nothing changed', () => {
    expect(collect({ patches: [], uncommitted: [], pendingPaths: [] })).toEqual([])
  })

  test('orders committed files by churn, biggest first', () => {
    const files = collect({
      patches: [patch('a.ts', 1, 1), patch('b.ts', 40, 0), patch('c.ts', 5, 5)],
      uncommitted: [],
      pendingPaths: []
    })

    expect(files.map((file) => file.path)).toEqual(['b.ts', 'c.ts', 'a.ts'])
    expect(files.every((file) => file.state === 'committed')).toBe(true)
  })

  test('puts a file the agent just wrote ahead of a bigger one', () => {
    const files = collect({
      patches: [patch('big.ts', 100, 0), patch('small.ts', 2, 0)],
      uncommitted: [],
      pendingPaths: ['small.ts']
    })

    expect(files.map((file) => file.path)).toEqual(['small.ts', 'big.ts'])
  })

  test('counts a path once when git has both committed and working-tree changes', () => {
    const files = collect({
      patches: [patch('src/App.tsx', 12, 3)],
      uncommitted: ['src/App.tsx'],
      pendingPaths: ['src/App.tsx']
    })

    expect(files).toHaveLength(1)
    expect(files[0].state).toBe('committed')
    expect(files[0].patch?.added).toBe(12)
  })

  test('keeps an uncommitted file that has no committed patch', () => {
    const files = collect({
      patches: [patch('src/App.tsx', 12, 3)],
      uncommitted: ['README.md'],
      pendingPaths: []
    })

    expect(files.map((file) => [file.path, file.state])).toEqual([
      ['src/App.tsx', 'committed'],
      ['README.md', 'uncommitted']
    ])
  })

  test('shows a just-written path git has not accounted for yet', () => {
    const files = collect({
      patches: [],
      uncommitted: [],
      pendingPaths: ['src/api/client.ts']
    })

    expect(files).toEqual([{ path: 'src/api/client.ts', patch: null, state: 'pending' }])
  })

  test('prefers uncommitted over pending for the same path', () => {
    const files = collect({
      patches: [],
      uncommitted: ['src/App.tsx'],
      pendingPaths: ['src/App.tsx']
    })

    expect(files).toHaveLength(1)
    expect(files[0].state).toBe('uncommitted')
  })

  test('keeps a committed file that produced no patch, below the ones that did', () => {
    // A binary or oversized blob is committed and has no text to diff. Dropping the
    // row would make the strip under-report what the agent touched, which is the one
    // thing it exists to get right.
    const files = collect({
      patches: [patch('src/App.tsx', 4, 1)],
      committedPaths: ['src/App.tsx', 'public/logo.png'],
      uncommitted: [],
      pendingPaths: []
    })

    expect(files.map((file) => [file.path, file.patch === null])).toEqual([
      ['src/App.tsx', false],
      ['public/logo.png', true]
    ])
    expect(files[1].state).toBe('committed')
  })

  test('lists every committed file first, then the rest most-recent first', () => {
    // Recency wins inside the uncommitted group too: a file the agent wrote this
    // turn is the one the user is most likely reaching for, ahead of a working-tree
    // edit that has been sitting there since before the conversation started.
    const files = collect({
      patches: [patch('a.ts', 1, 0)],
      uncommitted: ['z.md'],
      pendingPaths: ['y.md']
    })

    expect(files.map((file) => [file.path, file.state])).toEqual([
      ['a.ts', 'committed'],
      ['y.md', 'pending'],
      ['z.md', 'uncommitted']
    ])
  })
})
