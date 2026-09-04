/**
 * The rule is *first mark wins, once per turn*. Both halves have failed in the app:
 * a turn that settled without an `agent_end` never completed for the renderer, and
 * completing from both marks would report one turn twice.
 */

import { describe, expect, test } from 'bun:test'
import { createTurnTracker } from './turn-completion'

describe('createTurnTracker', () => {
  test('a turn that settles with no earlier mark still completes once', () => {
    const tracker = createTurnTracker()
    tracker.begin()

    // The `agent_settled` path, with no `agent_end { willRetry: false }` before it.
    tracker.settle()
    expect(tracker.claimCompletion()).toBe(true)
  })

  test('agent_end wins, and the settle that follows does not repeat it', () => {
    const tracker = createTurnTracker()
    tracker.begin()

    expect(tracker.claimCompletion()).toBe(true)
    tracker.settle()
    expect(tracker.claimCompletion()).toBe(false)
  })

  test('a retry does not reopen the turn, so it cannot re-arm the completion', () => {
    const tracker = createTurnTracker()
    expect(tracker.begin()).toBe(true)

    // Pi re-emits `agent_start` for every retry and every compaction continuation.
    expect(tracker.begin()).toBe(false)

    expect(tracker.claimCompletion()).toBe(true)
    expect(tracker.begin()).toBe(false)
    expect(tracker.claimCompletion()).toBe(false)
  })

  test('a settle with no turn behind it reports nothing', () => {
    const tracker = createTurnTracker()

    tracker.settle()
    expect(tracker.claimCompletion()).toBe(false)
  })

  test('the next turn gets its own completion', () => {
    const tracker = createTurnTracker()
    tracker.begin()
    tracker.claimCompletion()
    tracker.settle()

    expect(tracker.begin()).toBe(true)
    expect(tracker.claimCompletion()).toBe(true)
  })
})
