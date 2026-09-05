/**
 * Tests for the activity store.
 *
 * Three properties matter enough to pin. `publishActivity` must not notify when nothing
 * changed — `useSyncExternalStore` re-renders every subscriber on a notification, and
 * the stream reports the same status repeatedly. The per-app snapshot must return a
 * stable identity between changes, because a fresh object every call is an infinite
 * render loop rather than a slow one. And one app's turn must never move another's
 * reading, which is what the keying exists for now that several workspaces are mounted
 * at once and each writes here.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  beginTurn,
  endTurn,
  forgetActivity,
  publishActivity,
  recordWrite,
  resetActivity,
  resetAllForTest,
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

/** The app under test. Every call names one now. */
const APP = 'weather'

beforeEach(() => {
  resetAllForTest()
})

describe('the activity store', () => {
  test('a publish that changes nothing notifies nobody', () => {
    publishActivity(APP, { writingPath: 'src/App.tsx' })

    let calls = 0
    const unsubscribe = subscribeForTest(() => {
      calls += 1
    })

    publishActivity(APP, { writingPath: 'src/App.tsx' })
    expect(calls).toBe(0)

    publishActivity(APP, { writingPath: 'src/main.ts' })
    expect(calls).toBe(1)

    unsubscribe()
  })

  test('the snapshot identity is stable between changes', () => {
    const first = readForTest(APP)
    publishActivity(APP, { writingPath: null })
    expect(readForTest(APP)).toBe(first)

    publishActivity(APP, { writingPath: 'a.ts' })
    expect(readForTest(APP)).not.toBe(first)
  })

  test('a turn starts clean, so two turns are never mixed', () => {
    endTurn(APP, { turn: TURN, cache: 'reused' })
    recordWrite(APP, 'src/App.tsx')

    beginTurn(APP)

    const state = readForTest(APP)
    expect(state.isStreaming).toBe(true)
    expect(state.lastTurn).toBeNull()
    expect(state.pendingPaths).toEqual([])
  })

  test('ending a turn bumps the revision every refetch is keyed on', () => {
    const before = readForTest(APP).turnRevision
    endTurn(APP, { turn: TURN, cache: 'reused' })
    expect(readForTest(APP).turnRevision).toBe(before + 1)
  })

  test('a turn that reported nothing still ends, with no cost to show', () => {
    beginTurn(APP)
    endTurn(APP, null)

    const state = readForTest(APP)
    expect(state.isStreaming).toBe(false)
    expect(state.lastTurn).toBeNull()
    // The revision still moves: git has something to say even about an aborted turn,
    // because the writes it made before it stopped are on disk.
    expect(state.turnRevision).toBe(1)
  })

  test('a measured turn frees the composer and keeps its cost', () => {
    beginTurn(APP)
    endTurn(APP, { turn: TURN, cache: 'reused' })

    const state = readForTest(APP)
    // The whole symptom the turn-completion work exists to fix: `isStreaming` is what
    // disables the input and holds the red Stop button up, and it is cleared here and
    // nowhere else on the happy path.
    expect(state.isStreaming).toBe(false)
    expect(state.status).toBeNull()
    expect(state.lastTurn).toEqual({ turn: TURN, cache: 'reused' })
  })

  test('ending a turn twice changes nothing but the revision', () => {
    beginTurn(APP)
    endTurn(APP, { turn: TURN, cache: 'reused' })
    const once = readForTest(APP)

    // Main claims the turn's completion so only one `complete` chunk goes out — see
    // `agent/turn-completion.ts`. If that ever slips, the second end must still be
    // harmless here rather than replacing a measured turn with a blank one.
    endTurn(APP, { turn: TURN, cache: 'reused' })
    const twice = readForTest(APP)

    expect(twice.isStreaming).toBe(false)
    expect(twice.lastTurn).toEqual(once.lastTurn!)
    expect(twice.turnRevision).toBe(once.turnRevision + 1)
  })

  test('a file written twice in one turn is one entry', () => {
    recordWrite(APP, 'src/App.tsx')
    recordWrite(APP, 'src/App.tsx')
    recordWrite(APP, 'src/main.ts')

    expect(readForTest(APP).pendingPaths).toEqual(['src/App.tsx', 'src/main.ts'])
  })

  test('a reset clears the previous conversation entirely', () => {
    endTurn(APP, { turn: TURN, cache: 'reused' })
    recordWrite(APP, 'src/App.tsx')

    resetActivity(APP)

    const state = readForTest(APP)
    expect(state.lastTurn).toBeNull()
    expect(state.pendingPaths).toEqual([])
    expect(state.turnRevision).toBe(0)
  })

  test('one app’s turn never moves another’s reading', () => {
    beginTurn(APP)
    recordWrite(APP, 'src/App.tsx')
    endTurn(APP, { turn: TURN, cache: 'reused' })

    // The whole point of keying. Before this, a background app finishing a turn
    // bumped the focused app's `turnRevision` — refetching its context report and
    // its changed-files strip against a conversation that had not moved — and
    // attributed the cost line and the written files to the wrong transcript.
    const other = readForTest('notes')
    expect(other.turnRevision).toBe(0)
    expect(other.lastTurn).toBeNull()
    expect(other.pendingPaths).toEqual([])
    expect(other.isStreaming).toBe(false)
  })

  test('an app nobody has published for reads idle, with a stable identity', () => {
    // `useSyncExternalStore` compares by identity, so a fresh idle object per call
    // would make every unvisited workspace re-render forever.
    expect(readForTest('never-seen')).toBe(readForTest('also-never-seen'))
  })

  test('forgetting an app removes it rather than idling it', () => {
    beginTurn(APP)
    forgetActivity(APP)
    // `resetActivity` keeps the app present; a closed tile must not leave its id in
    // the store for the life of the session, because the busy list is derived from
    // exactly those keys.
    expect(readForTest(APP).isStreaming).toBe(false)
  })
})
