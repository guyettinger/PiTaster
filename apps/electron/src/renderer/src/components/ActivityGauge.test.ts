/**
 * Tests for what the activity gauge reads.
 *
 * Three states, and the one that matters most is the third: a finished turn with no
 * measured request must show nothing rather than a summary of zero. An aborted run and
 * a daemon that reported no usage both land there, and `0 requests · 0 prompt · 0s` is
 * worse than saying nothing at all.
 */

import { describe, expect, test } from 'bun:test'
import { summarizeActivity } from './ActivityGauge'
import type { AgentActivity } from '../state/agentActivity'
import type {
  CacheVerdict,
  ProviderRequestRecord,
  TelemetrySnapshot,
  TurnCost
} from '../types/electron'

/** An idle store. */
const IDLE: AgentActivity = {
  status: null,
  lastTurn: null,
  pendingPaths: [],
  writingPath: null,
  isStreaming: false,
  turnRevision: 0
}

/**
 * A turn that cost something.
 * @param overrides - Fields to change
 * @returns The turn
 */
function turn(overrides: Partial<TurnCost> = {}): TurnCost {
  return {
    requests: 2,
    promptTokens: 12200,
    prefilledTokens: 2300,
    outputTokens: 152,
    reasoningTokens: 0,
    rePrefills: 0,
    elapsedMs: 43_000,
    ...overrides
  }
}

/**
 * A telemetry reading holding the given number of requests.
 * @param count - How many records to fabricate
 * @returns The snapshot
 */
function snapshot(count: number): TelemetrySnapshot {
  const requests: ProviderRequestRecord[] = Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    startedAt: 0,
    status: 200,
    prefillMs: 100,
    firstTokenMs: 120,
    totalMs: 500,
    promptTokens: 1000,
    prefilledTokens: 100,
    cachedTokens: 900,
    outputTokens: 50,
    reasoningTokens: null,
    cache: 'reused' as CacheVerdict,
    outcome: 'ok'
  }))

  return {
    requests,
    totals: {
      requests: count,
      prefilledTokens: 100 * count,
      cachedTokens: 900 * count,
      outputTokens: 50 * count,
      reasoningTokens: 0,
      prefillMs: 100 * count,
      invalidations: 0,
      compactions: 0
    },
    turn: turn(),
    prefillRate: 1000,
    decodeRate: 20
  }
}

describe('summarizeActivity', () => {
  test('before any turn there is nothing to open', () => {
    const reading = summarizeActivity(IDLE, null)

    expect(reading.label).toBe('—')
    expect(reading.hasCard).toBe(false)
    expect(reading.pulse).toBe(false)
  })

  test('a running turn shows the status detail, pulsing', () => {
    const reading = summarizeActivity(
      { ...IDLE, isStreaming: true, status: { kind: 'compacting', detail: 'Summarizing…' } },
      snapshot(3)
    )

    expect(reading.pulse).toBe(true)
    expect(reading.label).toBe('Summarizing…')
    // Compaction, a retry and a long prefill are three different situations and used
    // to render identically. The colour is what tells them apart.
    expect(reading.dot).toBe('bg-keylime')
  })

  test('a retry earns the warning colour, because something already went wrong', () => {
    const reading = summarizeActivity(
      {
        ...IDLE,
        isStreaming: true,
        status: { kind: 'retrying', detail: 'Retrying', attempt: 2, maxAttempts: 5 }
      },
      snapshot(1)
    )

    expect(reading.dot).toBe('bg-rust')
    expect(reading.label).toBe('Retrying (2 of 5)')
  })

  test('a status-less running turn still says it is working', () => {
    const reading = summarizeActivity({ ...IDLE, isStreaming: true }, snapshot(1))

    expect(reading.pulse).toBe(true)
    expect(reading.label).toBe('Working…')
  })

  test('a finished turn reads as its duration', () => {
    const reading = summarizeActivity(
      { ...IDLE, lastTurn: { turn: turn(), cache: 'reused' } },
      snapshot(2)
    )

    expect(reading.label).toBe('43s')
    expect(reading.hasCard).toBe(true)
    // A healthy turn does not decorate itself.
    expect(reading.dot).toBe('bg-ash')
  })

  test('an invalidated prefix is the one verdict worth a colour', () => {
    const reading = summarizeActivity(
      { ...IDLE, lastTurn: { turn: turn(), cache: 'invalidated' } },
      snapshot(2)
    )

    expect(reading.dot).toBe('bg-rust')
  })

  test('a turn with no measured request shows no summary of zero', () => {
    const reading = summarizeActivity(
      { ...IDLE, lastTurn: { turn: turn({ requests: 0, elapsedMs: 0 }), cache: 'unknown' } },
      snapshot(2)
    )

    expect(reading.label).toBe('idle')
    expect(reading.label).not.toContain('0s')
  })
})
