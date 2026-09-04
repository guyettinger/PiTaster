/**
 * When a turn starts, and who gets to say it ended.
 *
 * Pi marks the end of a turn twice and neither mark is sufficient alone. `agent_end`
 * fires as soon as the agent loop stops, which is the earliest honest end and therefore
 * the one that should free the composer — but Pi re-emits it before every retry and
 * every overflow-compaction continuation, and a run can settle without a final
 * `agent_end` at all. `agent_settled` fires exactly once, after everything that could
 * continue the run has declined to, which makes it the reliable end and the late one.
 *
 * The renderer ends its turn on the `complete` chunk and on nothing else, so a turn
 * that settles without one leaves the composer disabled and the activity gauge pulsing
 * `Working…` behind a run that has finished. Emitting from both marks fixes that and
 * introduces the opposite fault: a second `complete` bumps `turnRevision` again, which
 * re-reads the context report and re-runs the session's git diff for a turn nothing has
 * added to.
 *
 * So the rule is *first mark wins, once per turn*, and this is the only place it lives.
 */

/**
 * Tracks one turn's boundaries.
 */
export interface TurnTracker {
  /**
   * A turn is starting.
   * @returns True when this actually opened a turn, false while one is already open
   */
  begin: () => boolean
  /**
   * Claim the right to emit this turn's `complete`.
   * @returns True for the first caller of a turn, false for every later one
   */
  claimCompletion: () => boolean
  /** The turn has settled. The next {@link begin} opens a fresh one. */
  settle: () => void
}

/**
 * Create a turn tracker.
 * @returns The tracker, with no turn open
 */
export function createTurnTracker(): TurnTracker {
  let open = false
  // Starts claimed, because before a turn exists there is nothing to report. A settle
  // that arrives with no turn behind it would otherwise emit a `complete` carrying a
  // summary of zero, and the renderer would spend a context report and a git diff
  // reconciling a turn that never ran.
  let claimed = true

  return {
    begin: (): boolean => {
      if (open) return false
      open = true
      // Armed here rather than at `settle`, so a claim made *at* settle — which is
      // where the reliable mark is — is not thrown away by the settle that produced it.
      claimed = false
      return true
    },

    claimCompletion: (): boolean => {
      if (claimed) return false
      claimed = true
      return true
    },

    settle: (): void => {
      open = false
    }
  }
}
