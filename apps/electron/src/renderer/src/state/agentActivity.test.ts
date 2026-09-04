/**
 * Tests for the activity store.
 *
 * Two properties matter enough to pin. `publishActivity` must not notify when nothing
 * changed — `useSyncExternalStore` re-renders every subscriber on a notification, and
 * the stream reports the same status repeatedly. And `getSnapshot` must return a stable
 * identity between changes, because a fresh object every call is an infinite render
 * loop rather than a slow one.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  beginTurn,
  endTurn,
  publishActivity,
  recordWrite,
  resetActivity,
  subscribeForTest,
  readForTest
} from './agentActivity'
import type { TurnCost } from '../types/electron'

/** A turn that cost something. */
const TURN: TurnCost = {
  requests: 2,
  promptTokens: 12200,
  prefilledTokens: 2300,
  outputTokens: 152,
  reasoningTokens: 0,
  rePrefills: 0,
  elapsedMs: 43_000
}

beforeEach(() => {
  resetActivity()
})

describe('the activity store', () => {
  test('a publish that changes nothing notifies nobody', () => {
    publishActivity({ writingPath: 'src/App.tsx' })

    let calls = 0
    const unsubscribe = subscribeForTest(() => {
      calls += 1
    })

    publishActivity({ writingPath: 'src/App.tsx' })
    expect(calls).toBe(0)

    publishActivity({ writingPath: 'src/main.ts' })
    expect(calls).toBe(1)

    unsubscribe()
  })

  test('the snapshot identity is stable between changes', () => {
    const first = readForTest()
    publishActivity({ writingPath: null })
    expect(readForTest()).toBe(first)

    publishActivity({ writingPath: 'a.ts' })
    expect(readForTest()).not.toBe(first)
  })

  test('a turn starts clean, so two turns are never mixed', () => {
    endTurn({ turn: TURN, cache: 'reused' })
    recordWrite('src/App.tsx')

    beginTurn()

    const state = readForTest()
    expect(state.isStreaming).toBe(true)
    expect(state.lastTurn).toBeNull()
    expect(state.pendingPaths).toEqual([])
  })

  test('ending a turn bumps the revision every refetch is keyed on', () => {
    const before = readForTest().turnRevision
    endTurn({ turn: TURN, cache: 'reused' })
    expect(readForTest().turnRevision).toBe(before + 1)
  })

  test('a turn that reported nothing still ends, with no cost to show', () => {
    beginTurn()
    endTurn(null)

    const state = readForTest()
    expect(state.isStreaming).toBe(false)
    expect(state.lastTurn).toBeNull()
    // The revision still moves: git has something to say even about an aborted turn,
    // because the writes it made before it stopped are on disk.
    expect(state.turnRevision).toBe(1)
  })

  test('a file written twice in one turn is one entry', () => {
    recordWrite('src/App.tsx')
    recordWrite('src/App.tsx')
    recordWrite('src/main.ts')

    expect(readForTest().pendingPaths).toEqual(['src/App.tsx', 'src/main.ts'])
  })

  test('a reset clears the previous conversation entirely', () => {
    endTurn({ turn: TURN, cache: 'reused' })
    recordWrite('src/App.tsx')

    resetActivity()

    const state = readForTest()
    expect(state.lastTurn).toBeNull()
    expect(state.pendingPaths).toEqual([])
    expect(state.turnRevision).toBe(0)
  })
})
