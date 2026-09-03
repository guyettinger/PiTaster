/**
 * Tests for the turn-level retry budget.
 *
 * The property worth protecting is that the budget measures SILENCE. It used to span
 * `agent_start` to `agent_end`, and `agent_start` fires once per agent run, so it
 * counted every productive tool call and every streamed token of a multi-step turn.
 * Measured on the author's sessions, 15 of 71 turns ran past the hour it allowed and
 * the longest ran 5.37 hours — so an ordinary retry after the hour mark reported a
 * model that had stopped responding while that model was still working.
 */

import { describe, expect, test } from 'bun:test'
import { HTTP_IDLE_TIMEOUT_MS } from './http-dispatcher'
import { createRetryBudget, formatSilence, TURN_RETRY_BUDGET_MS } from './retry-budget'

/**
 * Build a budget over a clock the test controls.
 * @param budgetMs - The wall-clock budget
 * @returns The budget and a function to advance its clock
 */
function withClock(budgetMs: number): {
  budget: ReturnType<typeof createRetryBudget>
  advance: (ms: number) => void
} {
  let now = 1_000
  const budget = createRetryBudget({ budgetMs, now: () => now })
  return {
    budget,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('createRetryBudget', () => {
  test('is not exhausted before a turn starts', () => {
    const { budget, advance } = withClock(1_000)
    advance(10_000)

    expect(budget.exhausted()).toBe(false)
  })

  test('is not exhausted inside the budget', () => {
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(999)

    expect(budget.exhausted()).toBe(false)
  })

  test('is exhausted once the silence runs past the budget', () => {
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(1_000)

    expect(budget.exhausted()).toBe(true)
  })

  test('a retry continuation does not refresh the budget', () => {
    // Pi emits `agent_start` again for every retry, and a retry is not progress. A
    // budget that restarted on it would measure one attempt and never bound anything.
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(600)
    budget.start()
    advance(600)

    expect(budget.exhausted()).toBe(true)
  })

  test('progress refreshes it, so a long turn that is working never trips', () => {
    // The whole point. This is the 2h20m turn that used to be cut at one hour.
    const { budget, advance } = withClock(1_000)
    budget.start()

    for (let i = 0; i < 100; i++) {
      advance(999)
      budget.noteProgress()
    }
    advance(999)

    expect(budget.exhausted()).toBe(false)
  })

  test('silence after progress still exhausts it', () => {
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(900)
    budget.noteProgress()
    advance(1_000)

    expect(budget.exhausted()).toBe(true)
  })

  test('progress outside a turn does not arm it', () => {
    // Otherwise the first event after a turn ends would start a clock nothing clears,
    // and the next turn would inherit a budget already part-spent.
    const { budget, advance } = withClock(1_000)
    budget.noteProgress()
    advance(5_000)

    expect(budget.exhausted()).toBe(false)
  })

  test('clearing lets the next turn start fresh', () => {
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(2_000)
    expect(budget.exhausted()).toBe(true)

    budget.clear()
    budget.start()
    advance(500)

    expect(budget.exhausted()).toBe(false)
  })

  test('reports the silence it measured, for a message that has to be believable', () => {
    const { budget, advance } = withClock(1_000)
    expect(budget.silentMs()).toBe(0)

    budget.start()
    advance(750)

    expect(budget.silentMs()).toBe(750)
  })

  test('the budget leaves room for more than one silent request', () => {
    // A turn should survive one full idle timeout and still get a real second
    // attempt; it should not survive five of them. Written against the constant
    // rather than a literal — a hardcoded 1_800_000 is what let this assertion stay
    // green while the value Pi actually used was 300_000.
    expect(TURN_RETRY_BUDGET_MS).toBeGreaterThan(HTTP_IDLE_TIMEOUT_MS)
    expect(TURN_RETRY_BUDGET_MS).toBeLessThan(HTTP_IDLE_TIMEOUT_MS * 5)
  })
})

describe('formatSilence', () => {
  test('renders minutes below an hour', () => {
    expect(formatSilence(4 * 60_000)).toBe('4m')
  })

  test('renders hours and minutes', () => {
    expect(formatSilence(2 * 3_600_000 + 4 * 60_000)).toBe('2h 4m')
  })

  test('drops a zero minute component', () => {
    expect(formatSilence(2 * 3_600_000)).toBe('2h')
  })

  test('never renders a negative silence', () => {
    expect(formatSilence(-5_000)).toBe('0m')
  })
})
