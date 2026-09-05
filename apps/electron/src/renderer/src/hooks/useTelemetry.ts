/**
 * What the session's provider requests actually cost.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { readableError } from '../lib/ipcError'
import { useAgentActivity } from '../state/agentActivity'
import type { TelemetrySnapshot } from '../types/electron'

/**
 * How often to re-read while a request is in flight.
 *
 * One IPC call answered from an in-memory ring buffer, so the cost is negligible and
 * the interval is chosen for how live the chart should feel rather than for load.
 */
const POLL_MS = 1000

/**
 * What {@link useTelemetry} returns.
 */
export interface UseTelemetryResult {
  /** The reading, or null before the first successful read. */
  snapshot: TelemetrySnapshot | null
  /** Why the last read failed, or null when it did not. */
  error: string | null
}

/**
 * Read the session's request history.
 *
 * Refetches on mount, on a finished turn, and — **only while a request is actually
 * open** — once a second. An idle panel makes no calls at all, which matters because
 * the Activity panel is the kind of thing people leave docked and then forget about.
 *
 * Main answers this without a live agent session, so there is no state in which there
 * is nothing to show: the recorder outlives the agent host by construction.
 *
 * **A failed read is reported, not swallowed.** A record is pushed the moment a request
 * is handed to the provider, so an empty snapshot while a turn is running is not a
 * state main can produce — it means the read never landed. Hiding that behind the
 * panel's "nothing measured yet" made a broken channel and an idle session render
 * identically, which is the one thing a diagnostic panel must not do. The last good
 * snapshot is still kept, so a single dropped read does not blank a working panel.
 *
 * @param appId - The workspace whose requests these are
 * @returns The snapshot and the last read failure
 */
export function useTelemetry(appId: string): UseTelemetryResult {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { turnRevision, isStreaming } = useAgentActivity(appId)

  // Drops a response that arrived after a newer request was already in flight, so a
  // slow read cannot overwrite a fresh one — the same guard the context report uses.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await window.electronAPI.getTelemetry(appId)
      if (latest.current !== ticket) return
      setSnapshot(next)
      setError(null)
    } catch (caught) {
      if (latest.current !== ticket) return
      setError(readableError(caught))
    }
  }, [appId])

  useEffect(() => {
    void refresh()
  }, [refresh, turnRevision])

  useEffect(() => {
    if (!isStreaming) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [isStreaming, refresh])

  return { snapshot, error }
}
