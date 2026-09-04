/**
 * Tests for the daemon gauge's reading.
 *
 * The rule under test is the one the fixed-height row forced: a fault takes over the
 * gauge's *label* rather than escalating into a second line. The old strip could add a
 * sentence above the composer; this cannot, and a colour alone would leave someone
 * whose turn just failed with nothing to read unless they happened to hover.
 */

import { describe, expect, test } from 'bun:test'
import { describeDaemon } from './DaemonGauge'
import type { DaemonHealth } from '../types/electron'

/**
 * A healthy reading, with the model resident for the given number of seconds.
 * @param seconds - Seconds until the daemon unloads it, or null for no expiry
 * @returns The reading
 */
function loaded(seconds: number | null): DaemonHealth {
  return {
    reachable: true,
    modelLoaded: true,
    expiresAt: seconds === null ? null : Date.now() + seconds * 1000
  }
}

describe('describeDaemon', () => {
  test('an unread health is unknown, never healthy', () => {
    const reading = describeDaemon(null, 'qwen3-coder:30b')

    expect(reading.isFault).toBe(false)
    expect(reading.dot).toBe('bg-line')
    expect(reading.detail).toContain('Checking')
  })

  test('a healthy daemon rests on the model name', () => {
    const reading = describeDaemon(loaded(null), 'qwen3-coder:30b')

    expect(reading.label).toBe('qwen3-coder:30b')
    expect(reading.isFault).toBe(false)
    expect(reading.dot).toBe('bg-patina')
  })

  test('an unreachable daemon replaces the label rather than adding to it', () => {
    const health: DaemonHealth = { reachable: false, modelLoaded: null, expiresAt: null }
    const reading = describeDaemon(health, 'qwen3-coder:30b')

    expect(reading.isFault).toBe(true)
    expect(reading.tone).toBe('text-rust')
    // The whole point: the model name is gone, so the fault is legible in the row's
    // fixed height without a pointer.
    expect(reading.label).not.toContain('qwen3-coder')
    expect(reading.label).toBe('Ollama not answering')
  })

  test('a model that is not loaded warns without claiming a failure', () => {
    const health: DaemonHealth = { reachable: true, modelLoaded: false, expiresAt: null }
    const reading = describeDaemon(health, 'qwen3-coder:30b')

    expect(reading.isFault).toBe(true)
    // Brass, not rust: the next turn works, it just pays for a reload first.
    expect(reading.tone).toBe('text-brass')
    expect(reading.detail).toContain('full model load')
  })

  test('an imminent unload counts down', () => {
    const reading = describeDaemon(loaded(45), 'qwen3-coder:30b')

    expect(reading.isFault).toBe(true)
    expect(reading.label).toMatch(/^unloads in 4[45]s$/)
  })

  test('a comfortable expiry is not a fault', () => {
    const reading = describeDaemon(loaded(20 * 60), 'qwen3-coder:30b')

    expect(reading.isFault).toBe(false)
    expect(reading.label).toBe('qwen3-coder:30b')
  })

  test('an elapsed expiry reads as unloaded rather than as a negative countdown', () => {
    const reading = describeDaemon(loaded(-30), 'qwen3-coder:30b')

    expect(reading.label).toBe('model unloaded')
    expect(reading.label).not.toContain('-')
  })

  test('no selected model still has a label to show', () => {
    const reading = describeDaemon(loaded(null), '')

    expect(reading.label).toBe('no model selected')
  })
})
