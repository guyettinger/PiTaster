/**
 * Stops the agent repeating itself.
 *
 * Small local models get stuck: they re-issue the same `read` or the same failing
 * `bash` indefinitely, each iteration costing a slow inference pass and pushing the
 * useful history further out of the context window. Nothing in Pi bounds that,
 * because from the loop's own point of view every call is a fresh, reasonable one.
 *
 * The guard is a narrowing, never a widening: it can only refuse a call the
 * permission gate would otherwise have allowed. It lives on the same `tool_call`
 * handler as that gate, which is the security boundary — see
 * `.claude/rules/self-modification.md`.
 */

/**
 * Identical consecutive calls tolerated before the agent is told to stop.
 *
 * Two is a legitimate retry — re-reading a file after an edit, re-running a test.
 * Three is a loop.
 */
const REPEAT_LIMIT = 3

/**
 * Longest argument serialization compared.
 *
 * A `write` carries a whole file; hashing all of it on every call to detect a repeat
 * is not worth it, and the prefix is enough to tell two calls apart in practice.
 */
const MAX_SIGNATURE_CHARS = 4096

/**
 * A verdict on one tool call.
 */
export interface LoopVerdict {
  /** Whether this call should be refused. */
  blocked: boolean
  /** What to tell the model, when it is refused. */
  reason?: string
}

/**
 * Tracks consecutive identical tool calls within one session.
 */
export interface LoopGuard {
  /**
   * Record a call and say whether it should be refused.
   * @param toolName - The tool being called
   * @param input - Its arguments
   * @returns The verdict
   */
  check: (toolName: string, input: unknown) => LoopVerdict
  /** Forget the streak; call when the user speaks, which always breaks a loop. */
  reset: () => void
}

/**
 * Reduce a call to a string two identical calls share.
 * @param toolName - The tool being called
 * @param input - Its arguments
 * @returns A comparable signature
 */
function signature(toolName: string, input: unknown): string {
  let args: string
  try {
    args = JSON.stringify(input) ?? ''
  } catch {
    // Circular or otherwise unserialisable arguments cannot be compared, so treat
    // every such call as distinct rather than risk blocking a legitimate one.
    args = `${Math.random()}`
  }
  return `${toolName}:${args.slice(0, MAX_SIGNATURE_CHARS)}`
}

/**
 * Create a loop guard for one session.
 * @returns The guard
 */
export function createLoopGuard(): LoopGuard {
  let lastSignature: string | null = null
  let repeats = 0

  return {
    check: (toolName: string, input: unknown): LoopVerdict => {
      const current = signature(toolName, input)

      if (current !== lastSignature) {
        lastSignature = current
        repeats = 1
        return { blocked: false }
      }

      repeats += 1
      if (repeats < REPEAT_LIMIT) return { blocked: false }

      // Reset so the model gets one clean attempt after being told, rather than
      // hitting the same wall on every subsequent call.
      lastSignature = null
      repeats = 0

      return {
        blocked: true,
        reason:
          `You have called \`${toolName}\` with identical arguments ${REPEAT_LIMIT} times in a row ` +
          'and gotten the same result each time. Repeating it will not help. Either try a ' +
          'different approach, or stop and tell the user what you are stuck on.'
      }
    },

    reset: () => {
      lastSignature = null
      repeats = 0
    }
  }
}
