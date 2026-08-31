/**
 * Tests for the stall notifier.
 *
 * Timing-driven, so the notifier takes its intervals as parameters and the tests run
 * at millisecond scale rather than the 20s the app uses.
 */

import { describe, expect, test } from 'bun:test'
import type { StreamChunk } from '@anyapp/core'
import { createStallNotifier } from './stall-notifier'

/** Short timings, so a test finishes in milliseconds. */
const FAST = { noticeMs: 30, refreshMs: 10 }

/**
 * Wait for a number of milliseconds.
 * @param ms - How long to wait
 * @returns A promise resolving after that long
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createStallNotifier', () => {
  test('says nothing while the run is quick', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    await delay(15)
    stall.clear()

    expect(chunks).toHaveLength(0)
  })

  test('reports a wait once the silence passes the threshold', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    await delay(60)
    stall.clear()

    const waiting = chunks.filter((c) => c.status?.kind === 'waiting')
    expect(waiting.length).toBeGreaterThan(0)
    expect(waiting[0].status?.detail).toContain('Waiting on the model')
  })

  test('clears the notice once it has reported one', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    await delay(60)
    stall.clear()

    expect(chunks[chunks.length - 1].status?.kind).toBe('settled')
  })

  test('activity restarts the clock', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    for (let i = 0; i < 5; i += 1) {
      await delay(10)
      stall.reset()
    }
    stall.clear()

    expect(chunks).toHaveLength(0)
  })

  test('reports again when a second run stalls', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    await delay(60)
    stall.clear()
    const first = chunks.filter((c) => c.status?.kind === 'waiting').length

    stall.arm()
    await delay(60)
    stall.clear()
    const second = chunks.filter((c) => c.status?.kind === 'waiting').length

    expect(second).toBeGreaterThan(first)
  })

  test('stops reporting after clear', async () => {
    const chunks: StreamChunk[] = []
    const stall = createStallNotifier({ onStream: (c) => chunks.push(c), ...FAST })

    stall.arm()
    stall.clear()
    await delay(60)

    expect(chunks).toHaveLength(0)
  })
})
