/**
 * Tests for the context budget derivation.
 *
 * The invariant these protect is `reserveTokens + keepRecentTokens < window * 0.9`.
 * Violating it makes Pi compact, find itself still over the threshold, and compact
 * again — which on a slow local model is indistinguishable from a hang.
 */

import { describe, expect, test } from 'bun:test'
import { deriveContextBudget, FALLBACK_CONTEXT_WINDOW } from './context-budget'

/** Windows spanning everything from a tiny local model to a frontier one. */
const WINDOWS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144]

describe('deriveContextBudget', () => {
  test('leaves room to compact into at every window', () => {
    for (const window of WINDOWS) {
      const budget = deriveContextBudget({ userOverride: window })
      const { reserveTokens, keepRecentTokens } = budget.compaction

      expect(reserveTokens + keepRecentTokens).toBeLessThan(window * 0.9)
      expect(keepRecentTokens).toBeGreaterThan(0)
      expect(reserveTokens).toBeGreaterThan(budget.maxTokens)
    }
  })

  test('never truncates a read Pi was entitled to return, where the window allows', () => {
    // Pi's own read tool caps at 50 KB. A trimmer cap below that fights it: the read
    // arrives legal and is then cut, and Pi's output has no line numbers for the
    // agent to work out what it lost.
    const piReadTokens = Math.floor((50 * 1024) / 4)

    for (const window of WINDOWS) {
      const budget = deriveContextBudget({ userOverride: window })

      expect(budget.maxToolResultTokens).toBeLessThanOrEqual(piReadTokens)
      if (window >= 65536) {
        expect(budget.maxToolResultTokens).toBe(piReadTokens)
      }
    }
  })

  test('the hard cap is above the ordinary one and below the window', () => {
    for (const window of WINDOWS) {
      const budget = deriveContextBudget({ userOverride: window })

      // The current turn is exempt from the ordinary cap, so a hard cap beneath it
      // would trim the turn harder than the history it is meant to protect.
      expect(budget.hardToolResultTokens).toBeGreaterThanOrEqual(budget.maxToolResultTokens)
      // And one result may never claim the whole window: the system prompt, the tool
      // schemas and the surrounding history have to fit beside it.
      expect(budget.hardToolResultTokens).toBeLessThanOrEqual(window * 0.5)
    }
  })

  test('never lets one turn of output claim the window', () => {
    for (const window of WINDOWS) {
      const budget = deriveContextBudget({ userOverride: window })
      expect(budget.maxTokens).toBeLessThanOrEqual(window * 0.25)
      expect(budget.maxTokens).toBeGreaterThan(0)
    }
  })

  test('prefers the user override over everything else', () => {
    const budget = deriveContextBudget({
      userOverride: 16384,
      daemonWindow: 65536,
      advertisedWindow: 262144
    })
    expect(budget.window).toBe(16384)
    expect(budget.source).toBe('user')
  })

  test('prefers the daemon over the advertised maximum', () => {
    const budget = deriveContextBudget({ daemonWindow: 65536, advertisedWindow: 262144 })
    expect(budget.window).toBe(65536)
    expect(budget.source).toBe('daemon')
  })

  test('caps an advertised maximum at the conservative default', () => {
    const budget = deriveContextBudget({ advertisedWindow: 262144 })
    expect(budget.window).toBe(FALLBACK_CONTEXT_WINDOW)
    expect(budget.source).toBe('fallback')
  })

  test('believes an advertised window smaller than the default', () => {
    const budget = deriveContextBudget({ advertisedWindow: 8192 })
    expect(budget.window).toBe(8192)
  })

  test('falls back when nothing is known', () => {
    expect(deriveContextBudget().window).toBe(FALLBACK_CONTEXT_WINDOW)
  })

  test('ignores unusable values', () => {
    const budget = deriveContextBudget({
      userOverride: 0,
      daemonWindow: Number.NaN,
      advertisedWindow: -1
    })
    expect(budget.window).toBe(FALLBACK_CONTEXT_WINDOW)
  })

  test('clamps an absurd override into range', () => {
    expect(deriveContextBudget({ userOverride: 10 }).window).toBe(2048)
    expect(deriveContextBudget({ userOverride: 10_000_000 }).window).toBe(262144)
  })

  test('compacts before the window is full, not after', () => {
    // Pi's rule is `tokens > window - reserveTokens`; the threshold must leave
    // enough room for the summarization call itself to fit.
    for (const window of WINDOWS) {
      const budget = deriveContextBudget({ userOverride: window })
      const threshold = window - budget.compaction.reserveTokens
      expect(threshold).toBeGreaterThan(budget.compaction.keepRecentTokens)
    }
  })
})
