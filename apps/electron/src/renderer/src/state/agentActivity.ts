/**
 * What each app's agent is doing right now, for everything that is not the transcript.
 *
 * A module store rather than a context, for a reason that is structural.
 * `WorkspaceContext`'s value is memoized precisely so that a change does not re-render
 * every panel — the transcript included, which is the most expensive tree in the app.
 * A revision bumped on every turn boundary would undo exactly what that memoization
 * buys. `useSyncExternalStore` re-renders only the components that subscribed.
 *
 * **Keyed by app id, and that is the whole of Session 28's change here.** Several
 * workspaces are mounted at once now, each with its own Chat writing to this store, so
 * a single reading would have app B's turn move app A's gauges — a turn count, a cost
 * line and a list of written files all attributed to the wrong conversation. The old
 * second reason for a module store (that `agent:stream` could have only one subscriber,
 * because unsubscribing was `removeAllListeners`) is gone: the bridge returns a real
 * unsubscribe now, and every subscription names its app.
 *
 * `Chat` is still the sole writer for its app, which means that with a Chat panel
 * closed that app's live status goes quiet. That is deliberate and acceptable: nothing
 * can start a turn with no composer, and the *measured* half — the telemetry the
 * Activity panel draws — comes from main over IPC and stays correct regardless of what
 * is mounted here.
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
 * Everything the gauges and the instrument panels read, for one app.
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

/** One reading per app that has had any. */
let readings: Record<string, AgentActivity> = {}

/** The apps with a turn in flight, as a stable array. See {@link useBusyAppIds}. */
let busy: readonly string[] = []

const listeners = new Set<() => void>()

/** Tell every subscriber something changed. */
function notify(): void {
  for (const listener of listeners) listener()
}

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
 * One app's current reading.
 *
 * Returns the same object identity until that app's reading actually changes, which is
 * what `useSyncExternalStore` requires — a fresh object every call is an infinite
 * render loop, not a slow one. An app nobody has published for reads as {@link IDLE},
 * which is the same shared object every time for the same reason.
 *
 * @param appId - The app to read
 * @returns What that app's agent is doing
 */
function readActivity(appId: string): AgentActivity {
  return readings[appId] ?? IDLE
}

/**
 * Recompute the busy list, keeping its identity when the membership has not changed.
 *
 * The rail re-renders every tile when this array changes, so a fresh array on every
 * status chunk would repaint the rail dozens of times a turn.
 */
function refreshBusy(): void {
  const next = Object.keys(readings).filter((appId) => readings[appId].isStreaming)
  if (next.length === busy.length && next.every((appId, index) => busy[index] === appId)) {
    return
  }
  busy = next
}

/**
 * Replace part of one app's reading and notify.
 *
 * A no-op when nothing in the patch differs from what is already stored, so a stream
 * that reports the same status twice does not re-render the panels watching it.
 *
 * @param appId - The app the reading belongs to
 * @param patch - The fields that changed
 */
export function publishActivity(appId: string, patch: Partial<AgentActivity>): void {
  const current = readActivity(appId)
  const next = { ...current, ...patch }

  const changed = (Object.keys(patch) as (keyof AgentActivity)[]).some(
    (key) => next[key] !== current[key]
  )
  if (!changed) return

  readings = { ...readings, [appId]: next }
  refreshBusy()
  notify()
}

/**
 * A turn is starting.
 *
 * Clears what the previous turn left behind — its cost line, the files it wrote — so
 * the gauges describe the turn in progress rather than mixing two of them.
 *
 * @param appId - The app whose turn is starting
 */
export function beginTurn(appId: string): void {
  publishActivity(appId, {
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
 * @param appId - The app whose turn finished
 * @param finished - What the turn cost, when it was measured
 */
export function endTurn(appId: string, finished: FinishedTurn | null): void {
  publishActivity(appId, {
    isStreaming: false,
    status: null,
    writingPath: null,
    lastTurn: finished,
    turnRevision: readActivity(appId).turnRevision + 1
  })
}

/**
 * Note that the agent has written a file.
 *
 * Additive and de-duplicated: a file written five times in one turn is one entry, the
 * same way the git read that replaces this list would report it.
 *
 * @param appId - The app whose agent wrote it
 * @param path - Path of the file, relative to the app root
 */
export function recordWrite(appId: string, path: string): void {
  const current = readActivity(appId)
  if (current.pendingPaths.includes(path)) return
  publishActivity(appId, { pendingPaths: [...current.pendingPaths, path] })
}

/**
 * Reset one app to idle, because its conversation changed.
 *
 * A session switch or a cleared history leaves the previous conversation's turn cost
 * and file list describing a transcript that is no longer on screen.
 *
 * @param appId - The app to reset
 */
export function resetActivity(appId: string): void {
  if (!readings[appId]) return
  readings = { ...readings, [appId]: IDLE }
  refreshBusy()
  notify()
}

/**
 * Drop an app's reading entirely, because its workspace is gone.
 *
 * Distinct from {@link resetActivity}, which keeps the app present and idle. This is
 * for a closed tile: leaving the entry behind would keep the app in `Object.keys` for
 * the life of the session, and a deleted app would stay there forever.
 *
 * @param appId - The app to forget
 */
export function forgetActivity(appId: string): void {
  if (!readings[appId]) return
  const next = { ...readings }
  delete next[appId]
  readings = next
  refreshBusy()
  notify()
}

/**
 * The store's subscribe function, for tests.
 *
 * Exported because the store is a module singleton with no React in it, and the
 * properties worth testing — that an unchanged publish notifies nobody, that one app's
 * turn does not move another's reading, and that the snapshot identity is stable
 * between changes — are properties of exactly these functions. Testing them through a
 * renderer would test React instead.
 */
export const subscribeForTest = subscribe

/**
 * One app's reading, for tests. See {@link subscribeForTest}.
 */
export const readForTest = readActivity

/**
 * Empty the whole store, for tests. Never called by the app.
 */
export function resetAllForTest(): void {
  readings = {}
  busy = []
  notify()
}

/**
 * Read what one app's agent is doing.
 *
 * @param appId - The app to watch
 * @returns Its current reading, re-rendering the caller when it changes
 */
export function useAgentActivity(appId: string): AgentActivity {
  return useSyncExternalStore(
    subscribe,
    () => readActivity(appId),
    () => readActivity(appId)
  )
}

/**
 * The apps with a turn in flight.
 *
 * What the nav rail's per-tile dots read. It is derived from the same store the gauges
 * use rather than from a second source, so a tile cannot claim an app is working while
 * that app's own composer says it is idle.
 *
 * @returns The busy app ids, stable while the membership does not change
 */
export function useBusyAppIds(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => busy,
    () => busy
  )
}
