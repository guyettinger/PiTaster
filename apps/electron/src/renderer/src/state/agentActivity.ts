/**
 * What the agent is doing right now, for everything that is not the transcript.
 *
 * A module store rather than a context, for two reasons that are both structural.
 *
 * `WorkspaceContext`'s value is memoized precisely so that a change does not re-render
 * every panel — the transcript included, which is the most expensive tree in the app.
 * A revision bumped on every turn boundary would undo exactly what that memoization
 * buys. `useSyncExternalStore` re-renders only the components that subscribed.
 *
 * And the stream itself can only have one subscriber: `offAgentStream` is
 * `removeAllListeners('agent:stream')`, so a panel that listened directly would tear
 * down the transcript's subscription the moment it unmounted.
 *
 * `Chat` is the sole writer, which means that with the Chat panel closed the live
 * status goes quiet. That is deliberate and acceptable: nothing can start a turn with
 * no composer, and the *measured* half — the telemetry the Activity panel draws — comes
 * from main over IPC and stays correct regardless of what is mounted here.
 */

import { useSyncExternalStore } from 'react'
import type { AgentStatus, CacheVerdict, TurnCost } from '../types/electron'

/**
 * What the last finished turn cost, and what the daemon did with the prefix.
 */
export interface FinishedTurn {
  /** The turn's totals. */
  turn: TurnCost
  /** What the daemon did with the prefix on the turn's last request. */
  cache: CacheVerdict
}

/**
 * Everything the gauges and the instrument panels read.
 */
export interface AgentActivity {
  /** What the agent is doing while it is not producing tokens, or null when idle. */
  status: AgentStatus | null
  /** What the last finished turn cost, or null before one has finished. */
  lastTurn: FinishedTurn | null
  /** Paths the agent has written this turn, before the next git read absorbs them. */
  pendingPaths: readonly string[]
  /** The file being written right now, or null when nothing is. */
  writingPath: string | null
  /** Whether a turn is in flight. */
  isStreaming: boolean
  /**
   * Bumped when a turn completes.
   *
   * The one moment the conversation's share of the context window changes, and the one
   * moment git has something new to say about what the session touched — so it is what
   * every refetch keyed on a turn boundary watches.
   */
  turnRevision: number
}

/** Nothing has happened yet. */
const IDLE: AgentActivity = {
  status: null,
  lastTurn: null,
  pendingPaths: [],
  writingPath: null,
  isStreaming: false,
  turnRevision: 0
}

let snapshot: AgentActivity = IDLE
const listeners = new Set<() => void>()

/**
 * Subscribe to changes. The store's half of {@link useAgentActivity}.
 * @param listener - Called after every change
 * @returns The unsubscribe function
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The current reading.
 *
 * Returns the same object identity until something actually changes, which is what
 * `useSyncExternalStore` requires — a fresh object every call is an infinite render
 * loop, not a slow one.
 *
 * @returns What the agent is doing
 */
function getSnapshot(): AgentActivity {
  return snapshot
}

/**
 * Replace part of the reading and notify.
 *
 * A no-op when nothing in the patch differs from what is already stored, so a stream
 * that reports the same status twice does not re-render the panels watching it.
 *
 * @param patch - The fields that changed
 */
export function publishActivity(patch: Partial<AgentActivity>): void {
  const next = { ...snapshot, ...patch }

  const changed = (Object.keys(patch) as (keyof AgentActivity)[]).some(
    (key) => next[key] !== snapshot[key]
  )
  if (!changed) return

  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * A turn is starting.
 *
 * Clears what the previous turn left behind — its cost line, the files it wrote — so
 * the gauges describe the turn in progress rather than mixing two of them.
 */
export function beginTurn(): void {
  publishActivity({
    isStreaming: true,
    status: null,
    lastTurn: null,
    pendingPaths: [],
    writingPath: null
  })
}

/**
 * A turn has finished.
 *
 * The cost is optional because a turn can end without one — an aborted run, or a
 * daemon that reported no usage. In that case the gauge shows no summary rather than a
 * summary of zero, which is the same refusal the old strip made.
 *
 * @param finished - What the turn cost, when it was measured
 */
export function endTurn(finished: FinishedTurn | null): void {
  publishActivity({
    isStreaming: false,
    status: null,
    writingPath: null,
    lastTurn: finished,
    turnRevision: snapshot.turnRevision + 1
  })
}

/**
 * Note that the agent has written a file.
 *
 * Additive and de-duplicated: a file written five times in one turn is one entry, the
 * same way the git read that replaces this list would report it.
 *
 * @param path - Path of the file, relative to the app root
 */
export function recordWrite(path: string): void {
  if (snapshot.pendingPaths.includes(path)) return
  publishActivity({ pendingPaths: [...snapshot.pendingPaths, path] })
}

/**
 * Reset to idle, because the conversation changed.
 *
 * A session switch or a cleared history leaves the previous conversation's turn cost
 * and file list describing a transcript that is no longer on screen.
 */
export function resetActivity(): void {
  snapshot = IDLE
  for (const listener of listeners) listener()
}

/**
 * The store's subscribe function, for tests.
 *
 * Exported because the store is a module singleton with no React in it, and the two
 * properties worth testing — that an unchanged publish notifies nobody, and that the
 * snapshot identity is stable between changes — are properties of exactly these two
 * functions. Testing them through a renderer would test React instead.
 */
export const subscribeForTest = subscribe

/**
 * The store's snapshot function, for tests. See {@link subscribeForTest}.
 */
export const readForTest = getSnapshot

/**
 * Read what the agent is doing.
 *
 * @returns The current reading, re-rendering the caller when it changes
 */
export function useAgentActivity(): AgentActivity {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
