/**
 * One turn at a time, across every workspace.
 *
 * N workspaces can hold N live transcripts, N pending approvals and N TypeScript
 * services, and their tools genuinely run in parallel. Token generation cannot,
 * because there is one Ollama daemon and one loaded model, and the two ways it
 * would otherwise go wrong are both silent:
 *
 * - **Serialized inside the daemon.** A second request queues there with no
 *   headers sent, which is indistinguishable from prefill. `stall-notifier` then
 *   apologises for a queue, `retry-budget` can cut a turn that never started, and
 *   telemetry books the wait as prefill — corrupting the `prefillRate` behind
 *   *"~1 min to prefill if the cache misses"* for every workspace, not just the
 *   one that waited.
 * - **Split by `OLLAMA_NUM_PARALLEL`.** The daemon divides the loaded context
 *   across slots. `/api/ps` reports the aggregate, so `getLoadedContextLength`
 *   over-reports the per-request window and `deriveContextBudget` sizes
 *   compaction against a window the model does not have — the head-truncation
 *   AGENTS.md's *"The context window is not what Ollama advertises"* exists to
 *   prevent, arriving from a new direction. The KV prefix cache is per slot too,
 *   so more workspaces than slots makes every turn a cold prefill and undoes the
 *   sealed-prefix design outright.
 *
 * So the queue is here, in front of the daemon, where the wait is *visible*: a
 * `queued` status naming the app being waited on, and a turn that can be
 * cancelled before it ever starts. Waiting here rather than inside `sendPrompt`
 * is also what keeps the wait out of telemetry — the session never sees it.
 */

/**
 * A place in the queue.
 */
export interface InferenceTicket {
  /** The app already holding the daemon, when this ticket had to queue. */
  readonly waitingBehind: string | null
  /**
   * Wait for the daemon.
   *
   * @throws {InferenceCancelled} If the ticket is cancelled before it starts
   */
  wait(): Promise<void>
  /** Give the daemon up. Idempotent, and safe to call on a cancelled ticket. */
  release(): void
}

/**
 * Thrown into a queued turn that was abandoned before it began.
 *
 * A distinct type because the caller must tell it apart from a failure: nothing
 * went wrong, the user pressed Stop, and the turn should end quietly rather than
 * report an error it did not have.
 */
export class InferenceCancelled extends Error {
  constructor() {
    super('Turn cancelled before it started')
    this.name = 'InferenceCancelled'
  }
}

/** One workspace waiting its turn. */
interface Waiter {
  appId: string
  start: () => void
  abandon: (error: InferenceCancelled) => void
  /**
   * Where this ticket got to.
   *
   * Three states rather than a `settled` flag, because `cancelled` and `running`
   * need different answers from `release`. With one flag, a workspace that had a
   * turn running *and* a second one queued would, on cancelling the queued one,
   * release the running one's hold on the daemon — the queue is keyed by app id,
   * so `finish` cannot tell the two apart on its own.
   */
  state: 'queued' | 'running' | 'cancelled'
}

/**
 * The process-wide turn queue.
 *
 * Not a general mutex: it knows which app holds it and which apps are waiting,
 * because both are things the user is shown.
 */
export class InferenceQueue {
  /** The app whose turn is running, or null when the daemon is free. */
  private running: string | null = null

  /** Turns waiting to start, oldest first. */
  private waiting: Waiter[] = []

  /**
   * Take a place in the queue.
   *
   * Returns immediately; the ticket's `wait` is what blocks. Splitting the two is
   * what lets the caller send a `queued` status *before* it starts waiting —
   * a status sent after would arrive only once the wait was already over.
   *
   * @param appId - The workspace asking for a turn
   * @returns Its ticket
   */
  acquire(appId: string): InferenceTicket {
    const queue = this
    if (this.running === null) {
      this.running = appId
      let released = false
      return {
        waitingBehind: null,
        async wait() {},
        release() {
          if (released) return
          released = true
          queue.finish(appId)
        }
      }
    }

    const waitingBehind = this.running
    let waiter: Waiter | null = null
    const started = new Promise<void>((resolve, reject) => {
      waiter = {
        appId,
        start: resolve,
        abandon: reject,
        state: 'queued'
      }
      queue.waiting.push(waiter)
    })
    // Attached now, not in `wait`. A ticket cancelled before anyone awaited it
    // would otherwise reject with no handler, which Electron reports as an
    // unhandled rejection and, with the right flags, ends the main process.
    void started.catch(() => {})

    let released = false
    return {
      waitingBehind,
      async wait() {
        await started
      },
      release() {
        if (released) return
        released = true
        // A ticket that never started holds nothing, so releasing it must not
        // hand the daemon on for a turn that never ran — and must especially not
        // do so when the *same* app has another turn actually running.
        if (waiter && waiter.state !== 'running') {
          queue.drop(waiter)
          return
        }
        queue.finish(appId)
      }
    }
  }

  /**
   * Abandon a workspace's *queued* turn, if it has one.
   *
   * Only a turn that has not started. A running turn is aborted through its
   * agent host, which is a different thing entirely — this queue has no reach
   * inside Pi's loop and must not pretend to.
   *
   * @param appId - The workspace whose queued turn to abandon
   * @returns Whether a queued turn was found and abandoned
   */
  cancel(appId: string): boolean {
    let cancelled = false
    for (const waiter of [...this.waiting]) {
      if (waiter.appId !== appId || waiter.state !== 'queued') continue
      waiter.state = 'cancelled'
      this.waiting = this.waiting.filter((entry) => entry !== waiter)
      waiter.abandon(new InferenceCancelled())
      cancelled = true
    }
    return cancelled
  }

  /** The app whose turn is running, or null. */
  activeAppId(): string | null {
    return this.running
  }

  /** How many turns are waiting to start. */
  queueLength(): number {
    return this.waiting.length
  }

  /** Remove a waiter that gave up without ever starting. */
  private drop(waiter: Waiter): void {
    if (waiter.state === 'queued') waiter.state = 'cancelled'
    this.waiting = this.waiting.filter((entry) => entry !== waiter)
  }

  /** Hand the daemon to the next waiter, or leave it free. */
  private finish(appId: string): void {
    // Guarded, because a stale release must not evict the turn that came after
    // it. `release` is idempotent per ticket, but two tickets for one app can
    // exist across a fast stop-and-resend.
    if (this.running !== appId) return
    this.running = null

    const next = this.waiting.shift()
    if (!next) return
    next.state = 'running'
    this.running = next.appId
    next.start()
  }
}

/**
 * The queue every turn goes through.
 *
 * A module singleton because the thing it protects is a singleton: one daemon,
 * one loaded model, one process.
 */
export const inferenceQueue = new InferenceQueue()
