/**
 * Bounds how long a turn may go without producing anything.
 *
 * Pi's retry policy is right for the way a local daemon fails: connection refused
 * while it restarts, a 500 when it runs out of memory, a dropped socket. Those fail
 * in seconds, so four attempts costs almost nothing and usually recovers.
 *
 * It is wrong for the other failure this app has, because Pi cannot tell them apart.
 * `isRetryableAssistantError` matches on the error text, and that list includes
 * `"timed? out"` — so a request that produced no bytes for the whole of
 * `HTTP_IDLE_TIMEOUT_MS` is retried like a dropped socket. A request that sat silent
 * for an hour will do the same on the next attempt: 1 initial plus 4 retries is five
 * hours of a turn the user has no reason to believe is still alive.
 *
 * Rather than cutting the retry count — which would give up the cheap retries that
 * are the reason the policy exists — this measures a wall clock and stops the run
 * once retrying can no longer be described as recovery.
 *
 * WHAT IT MEASURES IS SILENCE, NOT THE TURN. This bounded `agent_start` to
 * `agent_end` once, and `agent_start` fires once per agent RUN — per-step progress
 * arrives as separate `turn_start`/`turn_end` events — so the budget spanned every
 * productive tool call and every successfully streamed token of a multi-step turn.
 * Measured on the author's own sessions: 15 of 71 turns ran past the hour it allowed
 * and the longest ran 5.37 hours, so the first ordinary retry after the hour mark
 * reported a model that had stopped responding while that model was still working.
 * A turn is not evidence of anything; a gap with nothing in it is. So the clock
 * restarts on every event the run emits, and only consecutive dead time accumulates.
 */

import { HTTP_IDLE_TIMEOUT_MS } from './http-dispatcher'

/**
 * The longest a turn may produce nothing at all before it is reported as failed.
 *
 * Chosen against `HTTP_IDLE_TIMEOUT_MS`: one full silent request, plus room for a
 * second attempt to get somewhere, and nothing beyond that. It MUST stay greater than
 * that timeout, or a prefill still inside its own budget would be cut by this one.
 * A local daemon has no request budget to protect, so this is about what a person
 * will sit through, not about cost.
 */
export const TURN_RETRY_BUDGET_MS = HTTP_IDLE_TIMEOUT_MS * 2

/**
 * Tracks how long the current turn has gone without producing anything.
 */
export interface RetryBudget {
  /** Begin timing a turn. Ignored while one is already being timed. */
  start: () => void
  /**
   * Note that the run produced something, restarting the clock.
   *
   * Anything at all counts. The question this budget answers is whether the run is
   * alive, and an event is proof that it is.
   */
  noteProgress: () => void
  /**
   * Whether the turn has been silent long enough that retrying is no longer recovery.
   *
   * @returns True when retrying is no longer recovery
   */
  exhausted: () => boolean
  /** How long the run has been silent, for a message that has to be believable. */
  silentMs: () => number
  /** Finish timing. Call when the turn ends for good, not between retries. */
  clear: () => void
}

/**
 * Parameters for {@link createRetryBudget}.
 */
export interface CreateRetryBudgetParams {
  /** Wall-clock budget for one silence. Defaults to {@link TURN_RETRY_BUDGET_MS}. */
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

  let quietSince: number | undefined

  return {
    start: (): void => {
      // Pi re-emits `agent_start` for every retry continuation, so only the first one
      // begins the turn. Restarting here would refresh the budget on each retry and
      // the bound would never be reached — a retry is not progress.
      if (quietSince === undefined) quietSince = now()
    },

    noteProgress: (): void => {
      // Only while a turn is being timed. Events outside one must not arm the budget,
      // or the first event after a turn ends would start a clock nothing clears.
      if (quietSince !== undefined) quietSince = now()
    },

    exhausted: (): boolean => {
      if (quietSince === undefined) return false
      return now() - quietSince >= budgetMs
    },

    silentMs: (): number => (quietSince === undefined ? 0 : now() - quietSince),

    clear: (): void => {
      quietSince = undefined
    }
  }
}

/**
 * Render a silence as something a person can check against the clock.
 *
 * The message this feeds used to assert the model had stopped responding without
 * saying how it knew. Naming the gap makes the claim falsifiable on screen: if it
 * reads two minutes, the bound is wrong, not the model.
 *
 * @param ms - How long the run has produced nothing
 * @returns A short duration, for example `4m` or `2h 4m`
 */
export function formatSilence(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}
