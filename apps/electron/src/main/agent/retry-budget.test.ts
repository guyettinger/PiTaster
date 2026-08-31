/**
 * Tests for the turn-level retry budget.
 *
 * The property worth protecting is that the budget spans a whole turn rather than one
 * attempt. Pi re-emits `agent_start` for every retry continuation, so a budget that
 * restarted there would never be reached and the bound would be silently absent.
 */

import { describe, expect, test } from 'bun:test'
import { createRetryBudget, TURN_RETRY_BUDGET_MS } from './retry-budget'

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

  test('is exhausted once the budget is spent', () => {
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(1_000)

    expect(budget.exhausted()).toBe(true)
  })

  test('a retry continuation does not refresh the budget', () => {
    // This is the whole point. Pi emits `agent_start` again for every retry, so a
    // budget that restarted on it would measure one attempt and never bound the turn.
    const { budget, advance } = withClock(1_000)
    budget.start()
    advance(600)
    budget.start()
    advance(600)

    expect(budget.exhausted()).toBe(true)
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

  test('the default budget leaves room for more than one silent request', () => {
    // A turn should survive one full idle timeout and still get a real second
    // attempt; it should not survive five of them.
    expect(TURN_RETRY_BUDGET_MS).toBeGreaterThan(1_800_000)
    expect(TURN_RETRY_BUDGET_MS).toBeLessThan(1_800_000 * 5)
  })
})
