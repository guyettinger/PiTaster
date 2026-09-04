/**
 * A warning about the local daemon, shown only when there is one.
 */

import type { DaemonHealth } from '../types/electron'
import { WarningIcon } from './icons'

/**
 * How close to being unloaded a model has to be before it is worth saying.
 *
 * `warmModel` asks for 30 minutes, but a model loaded by anything else carries the
 * daemon's 5-minute default — so this fires on the case that actually costs
 * something: a model about to be evicted under a person who is still working.
 */
const UNLOAD_WARNING_MS = 2 * 60 * 1000

/**
 * Props for the DaemonHealthStrip component.
 */
interface DaemonHealthStripProps {
  /** The last health reading, or null before there is one. */
  health: DaemonHealth | null
}

/**
 * Say what is wrong with the daemon, and nothing when nothing is.
 *
 * Health was checked in one place — Settings, once, on mount — which is the one place
 * a person is not looking when a turn fails to start. It is checked here because this
 * sits beside the composer, where the next turn begins.
 *
 * It renders nothing in the healthy case deliberately. A strip that is always present
 * is a strip that stops being read, which is the same reasoning `ChangedFilesStrip`
 * hides itself on an empty session.
 */
export function DaemonHealthStrip({ health }: DaemonHealthStripProps) {
  if (health === null) return null

  const message = describe(health)
  if (message === null) return null

  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 text-[12px] text-rust">
      <span aria-hidden className="shrink-0">
        <WarningIcon size={13} />
      </span>
      <span role="status">{message}</span>
    </div>
  )
}

/**
 * The one sentence worth showing, or null when the daemon is fine.
 * @param health - The reading
 * @returns The warning, or null
 */
function describe(health: DaemonHealth): string | null {
  if (!health.reachable) {
    return 'Ollama is not answering. The next turn will fail until the daemon is running.'
  }
  if (health.modelLoaded === false) {
    return 'The model is not loaded. The next turn pays a full model load before it starts.'
  }
  if (health.expiresAt === null) return null

  const remaining = health.expiresAt - Date.now()
  if (remaining > UNLOAD_WARNING_MS) return null
  if (remaining <= 0) {
    return 'The model has been unloaded. The next turn pays a full model load before it starts.'
  }
  return `Ollama unloads the model in ${Math.max(1, Math.round(remaining / 1000))}s — the next turn after that pays a full model load.`
}
