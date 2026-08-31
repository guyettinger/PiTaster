/**
 * Bounds how long one turn may spend being retried.
 *
 * Pi's retry policy is right for the way a local daemon fails: connection refused
 * while it restarts, a 500 when it runs out of memory, a dropped socket. Those fail
 * in seconds, so four attempts costs almost nothing and usually recovers.
 *
 * It is wrong for the other failure this app has, because Pi cannot tell them apart.
 * `isRetryableAssistantError` matches on the error text, and that list includes
 * `"timed? out"` — so `APIConnectionTimeoutError: Request timed out.`, which is what
 * a prefill that produced no bytes for the whole of `HTTP_IDLE_TIMEOUT_MS` looks
 * like, is retried like a dropped socket. A request that sat silent for thirty
 * minutes will do the same on the next attempt: 1 initial plus 4 retries is two and a
 * half hours of a turn the user has no reason to believe is still alive.
 *
 * Rather than cutting the retry count — which would give up the cheap retries that
 * are the reason the policy exists — this measures the run against a wall clock and
 * stops it once retrying can no longer be described as recovery. Fast failures never
 * come near the budget; a hung request exhausts it on the first retry.
 */

/**
 * The longest one turn may spend before it is reported as failed.
 *
 * Chosen against `HTTP_IDLE_TIMEOUT_MS`: one full silent request, plus room for a
 * second attempt to get somewhere, and nothing beyond that. A local daemon has no
 * request budget to protect, so this is about what a person will sit through, not
 * about cost.
 */
export const TURN_RETRY_BUDGET_MS = 3_600_000

/**
 * Tracks the wall-clock cost of one turn across its retries.
 */
export interface RetryBudget {
  /** Begin timing a turn. Ignored while one is already being timed. */
  start: () => void
  /**
   * Whether the turn has spent its budget and should stop retrying.
   *
   * @returns True when retrying is no longer recovery
   */
  exhausted: () => boolean
  /** Finish timing. Call when the turn ends for good, not between retries. */
  clear: () => void
}

/**
 * Parameters for {@link createRetryBudget}.
 */
export interface CreateRetryBudgetParams {
  /** Wall-clock budget for one turn. Defaults to {@link TURN_RETRY_BUDGET_MS}. */
  budgetMs?: number
  /** Clock, injectable so the budget can be tested without waiting for it. */
  now?: () => number
}

/**
 * Create a retry budget.
 * @param params - The budget and the clock
 * @returns The budget tracker
 */
export function createRetryBudget(params: CreateRetryBudgetParams = {}): RetryBudget {
  const { budgetMs = TURN_RETRY_BUDGET_MS, now = Date.now } = params

  let startedAt: number | undefined

  return {
    start: (): void => {
      // Pi re-emits `agent_start` for every retry continuation, so only the first one
      // begins the turn. Restarting here would refresh the budget on each retry and
      // the bound would never be reached.
      if (startedAt === undefined) startedAt = now()
    },

    exhausted: (): boolean => {
      if (startedAt === undefined) return false
      return now() - startedAt >= budgetMs
    },

    clear: (): void => {
      startedAt = undefined
    }
  }
}
