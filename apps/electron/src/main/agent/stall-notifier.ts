/**
 * Tells the user the model is still working when nothing has happened for a while.
 *
 * Prefill on a large context produces no output at all — a local model can spend
 * minutes there. Pi has no event for it, because nothing is happening, so the silence
 * has to be timed from outside. Left unreported it is indistinguishable from a crash,
 * and the usual response is to kill a run that was about to succeed.
 */

import type { StreamChunk } from '@anyapp/core'

/** Silence after which the user is told the model is still working. */
export const STALL_NOTICE_MS = 20_000

/** How often the notice refreshes its elapsed time, so it reads as progress. */
export const STALL_REFRESH_MS = 5_000

/**
 * A stall notifier, tracking whether the run has gone quiet.
 */
export interface StallNotifier {
  /** Start watching. Call when a run begins. */
  arm: () => void
  /** Note that something happened, restarting the clock. */
  reset: () => void
  /** Stop watching and clear any notice. */
  clear: () => void
}

/**
 * Parameters for {@link createStallNotifier}.
 */
export interface CreateStallNotifierParams {
  /** Where to send status chunks. */
  onStream: (chunk: StreamChunk) => void
  /** Silence tolerated before the first notice. Defaults to {@link STALL_NOTICE_MS}. */
  noticeMs?: number
  /** How often to refresh the notice. Defaults to {@link STALL_REFRESH_MS}. */
  refreshMs?: number
}

/**
 * Create a stall notifier.
 * @param params - Where to report, and how patient to be
 * @returns The notifier
 */
export function createStallNotifier(params: CreateStallNotifierParams): StallNotifier {
  const {
    onStream,
    noticeMs = STALL_NOTICE_MS,
    refreshMs = STALL_REFRESH_MS
  } = params

  let timer: ReturnType<typeof setInterval> | undefined
  let startedAt = 0
  let notified = false

  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const settle = (): void => {
    if (!notified) return
    notified = false
    onStream({ type: 'status', status: { kind: 'settled' } })
  }

  const tick = (): void => {
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs < noticeMs) return

    notified = true
    onStream({
      type: 'status',
      status: {
        kind: 'waiting',
        detail: `Waiting on the model — ${Math.round(elapsedMs / 1000)}s so far. Prefill on a large context can take minutes.`
      }
    })
  }

  return {
    arm: () => {
      stop()
      startedAt = Date.now()
      notified = false
      timer = setInterval(tick, refreshMs)
      // Node keeps the process alive for pending timers; this one must not.
      timer.unref?.()
    },

    reset: () => {
      startedAt = Date.now()
      settle()
    },

    clear: () => {
      stop()
      settle()
    }
  }
}
