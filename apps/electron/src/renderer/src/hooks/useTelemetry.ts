/**
 * What the session's provider requests actually cost.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
 * Read the session's request history.
 *
 * Refetches on mount, on a finished turn, and — **only while a request is actually
 * open** — once a second. An idle panel makes no calls at all, which matters because
 * the Activity panel is the kind of thing people leave docked and then forget about.
 *
 * Main answers this without a live agent session, so there is no state in which there
 * is nothing to show: the recorder outlives the agent host by construction.
 *
 * @returns The snapshot, or null before the first read settles
 */
export function useTelemetry(): TelemetrySnapshot | null {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const { turnRevision, isStreaming } = useAgentActivity()

  // Drops a response that arrived after a newer request was already in flight, so a
  // slow read cannot overwrite a fresh one — the same guard the context report uses.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await window.electronAPI.getTelemetry()
      if (latest.current === ticket) setSnapshot(next)
    } catch {
      // Telemetry is diagnostic. A failed read keeps the last answer rather than
      // blanking a panel over a channel that will answer again in a second.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, turnRevision])

  useEffect(() => {
    if (!isStreaming) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [isStreaming, refresh])

  return snapshot
}
