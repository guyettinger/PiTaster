/**
 * One task at a time, per key.
 *
 * Two of main's JSON stores are read-modify-write over a whole file —
 * `session-baselines.ts` and `layout-store.ts` both parse the store, fold one
 * entry in, and rewrite it. With one workspace that was safe by accident: nothing
 * else was writing. With several, two interleaved calls both read the same
 * pre-state and the second write drops the first entry entirely.
 *
 * The cost is not symmetric between the two, which is why this exists at all
 * rather than being left as a tolerable race. A lost layout is a lost drag, and
 * the user drags again. A lost *baseline* is permanent: `ensureSessionBaseline`
 * is first-write-wins, so the moment its entry is dropped the session's changed-
 * files strip has no commit to measure from and reports an empty session for the
 * rest of that session's life — with no error and nothing to retry.
 *
 * Keyed by store path rather than global, so a layout write never waits behind a
 * baseline write. The chain entry is dropped when it drains, so an idle store
 * holds nothing.
 */

/** The tail of each key's chain, while it has one. */
const chains = new Map<string, Promise<unknown>>()

/**
 * Run a task after every task already queued for the same key.
 *
 * The task's rejection is delivered to *its* caller and does not poison the
 * chain — a failed write must not wedge every later write to the same file.
 *
 * @param key - What the tasks contend for, usually an absolute file path
 * @param task - The work to run once the key is free
 * @returns Whatever the task returns
 */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  // `.then(task, task)` rather than `.finally`: the predecessor's outcome is the
  // predecessor's caller's business, and swallowing it here is what keeps one
  // rejection from cascading down the whole chain.
  const run = previous.then(task, task)
  // Settled, not resolved, so the next task waits for this one to finish either
  // way — and caught, so an unhandled rejection is never raised on the chain copy.
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  chains.set(key, settled)
  void settled.then(() => {
    // Only if nothing else queued behind us, or the tail belongs to a later task.
    if (chains.get(key) === settled) chains.delete(key)
  })
  return run
}

/** Whether anything is queued for a key. Tests only. */
export function isBusy(key: string): boolean {
  return chains.has(key)
}
