/**
 * Whether the local daemon can answer, polled.
 */

import { useEffect, useState } from 'react'
import type { DaemonHealth } from '../types/electron'

/**
 * How often to ask.
 *
 * One `/api/ps` against a daemon on the same machine, so the cost is negligible and
 * the interval is chosen for how stale the answer may be rather than for load. A
 * model's remaining life is counted in minutes, so half a minute is fine.
 */
const POLL_MS = 30_000

/**
 * Watch the daemon's health.
 *
 * Returns null until the first answer arrives, which is a state the UI must render as
 * *unknown* rather than as healthy. Settings used to initialise its own flag to `true`
 * and so flashed "Ollama is running" at every open, including when it was not.
 *
 * @returns The last reading, or null before there is one
 */
export function useDaemonHealth(): DaemonHealth | null {
  const [health, setHealth] = useState<DaemonHealth | null>(null)

  useEffect(() => {
    let cancelled = false

    const read = async (): Promise<void> => {
      try {
        const next = await window.electronAPI.getDaemonHealth()
        if (!cancelled) setHealth(next)
      } catch {
        // A failed probe is itself an answer, and the same one a refused connection
        // gives: the daemon is not usable from here.
        if (!cancelled) setHealth({ reachable: false, modelLoaded: null, expiresAt: null })
      }
    }

    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return health
}
