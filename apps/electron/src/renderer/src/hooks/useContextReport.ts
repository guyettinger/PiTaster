import { useCallback, useEffect, useRef, useState } from 'react'
import { readableError } from '../lib/ipcError'
import type { ContextReport } from '../types/electron'

/**
 * What {@link useContextReport} returns.
 */
export interface UseContextReportResult {
  /** What the window holds, or null before the first read settles. */
  report: ContextReport | null
  /** Re-read it from main. */
  refresh: () => Promise<void>
  /** Summarize the conversation now rather than waiting for the threshold. */
  compact: () => Promise<void>
  /** True while a manual compaction is running. */
  isCompacting: boolean
  /** The last compaction failure, or null. */
  error: string | null
}

/**
 * The context report for the open chat.
 *
 * Main answers this without a live agent session, so unlike the usage number this
 * replaces there is no state in which there is nothing to show — see
 * `main/agent/context-report.ts`. That is the whole reason the hook exists rather than
 * the chat panel reading usage off the `complete` chunk: the number has to survive the
 * panel unmounting, the session changing, and the agent host being torn down, none of
 * which the old path did.
 *
 * @param sessionId - The active chat session, refetched when it changes
 * @param revision - Bump to refetch; the chat panel bumps it when a turn completes
 * @returns The report and the actions that change it
 */
export function useContextReport(
  sessionId: string | null,
  revision: number
): UseContextReportResult {
  const [report, setReport] = useState<ContextReport | null>(null)
  const [isCompacting, setIsCompacting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reads are cheap but not free — main walks the whole message list — and the chat
  // panel asks for one on every completed turn. This drops a response that arrived
  // after a newer request was already in flight, so a slow read cannot overwrite a
  // fresh one.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = latest.current + 1
    latest.current = ticket

    try {
      const next = await window.electronAPI.getContextReport()
      if (latest.current === ticket) setReport(next)
    } catch {
      // A report is diagnostic. Failing to read one is not worth an error in the
      // composer; the meter keeps showing the last answer.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, sessionId, revision])

  const compact = useCallback(async () => {
    setIsCompacting(true)
    setError(null)

    try {
      await window.electronAPI.compactContext()
      await refresh()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setIsCompacting(false)
    }
  }, [refresh])

  return { report, refresh, compact, isCompacting, error }
}
