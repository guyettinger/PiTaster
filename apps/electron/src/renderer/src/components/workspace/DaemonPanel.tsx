/**
 * The local daemon: whether it can answer, what it is holding, and how fast.
 */

import { useEffect, useState } from 'react'
import { describeDaemon } from '../DaemonGauge'
import { formatRate, formatTokens } from '../../lib/measures'
import { useContextReport } from '../../hooks/useContextReport'
import { useDaemonHealth } from '../../hooks/useDaemonHealth'
import { useTelemetry } from '../../hooks/useTelemetry'
import { useAgentActivity } from '../../state/agentActivity'
import { useWorkspace } from './WorkspaceContext'
import type { ContextReport } from '../../types/electron'

/**
 * How often to redraw the countdown.
 *
 * The health reading itself is polled every 30s; this only re-renders the remaining
 * time between those, so a model with 40 seconds left counts down rather than jumping
 * in half-minute steps.
 */
const TICK_MS = 1000

/**
 * Everything about the daemon in one place.
 *
 * Health used to be checked in exactly one place — Settings, once, on mount — which is
 * the one place a person is not looking when a turn fails to start. The gauge answers
 * that at a glance; this answers the follow-up question, which is always some form of
 * *why is this slow*: what is loaded, how long it has left, and what the daemon's
 * measured prefill and decode rates actually are on this machine.
 *
 * It reads only from hooks that already exist. There is no new main-side work here.
 */
export function DaemonPanel() {
  const { activeSessionId } = useWorkspace()
  const { turnRevision } = useAgentActivity()
  const health = useDaemonHealth()
  const { snapshot: telemetry } = useTelemetry()
  const { report } = useContextReport(activeSessionId, turnRevision)
  const [model, setModel] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI
      .getConfig()
      .then((config) => {
        if (!cancelled) setModel(config.ollamaModel ?? '')
      })
      .catch(() => {
        // The model name is a label. Failing to read it is not worth an error state
        // beside a health reading that answers the question people came here with.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Only while there is a countdown to run. An expired or absent model needs no ticks.
  const hasCountdown = health?.expiresAt != null && health.expiresAt > Date.now()
  useEffect(() => {
    if (!hasCountdown) return
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [hasCountdown])

  const reading = describeDaemon(health, model)

  return (
    // The figures are label-and-value pairs with the value pushed right, so the
    // measure is capped: docked into a wide group they would otherwise sit a
    // thousand pixels apart with nothing between them to carry the eye across.
    <div className="h-full overflow-y-auto bg-panel [&>section]:max-w-md">
      <section className="border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${reading.dot}`} />
          <span className={`text-[13px] ${reading.isFault ? 'text-rust' : 'text-bone'}`}>
            {reading.label}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ash">{reading.detail}</p>
        <p className="mt-2 truncate font-mono text-[11px] text-bone">{model || 'no model selected'}</p>
      </section>

      {health?.expiresAt != null && <Residency expiresAt={health.expiresAt} />}

      <section className="border-b border-line px-3 py-3">
        <h3 className="eyebrow pb-1.5 text-ash">Measured on this machine</h3>
        <Row label="Prefill" value={formatRate(telemetry?.prefillRate ?? null) ?? 'no sample yet'} />
        <Row label="Decode" value={formatRate(telemetry?.decodeRate ?? null) ?? 'no sample yet'} />
        <p className="mt-1.5 text-[11px] text-ash">
          Medians over this session&rsquo;s requests. A rate Pi Taster has not measured is
          absent rather than guessed at — the same rule the context window follows.
        </p>
      </section>

      {report && <Window report={report} />}
    </div>
  )
}

/**
 * Props for {@link Residency}.
 */
interface ResidencyProps {
  /** When the daemon will unload the model, epoch ms. */
  expiresAt: number
}

/**
 * How long the model has left in memory.
 *
 * Worth its own block because the cost it predicts is large and invisible: a model that
 * has been evicted costs a full reload — tens of seconds on a 32 GB model — on a turn
 * that otherwise looks completely ordinary.
 */
function Residency({ expiresAt }: ResidencyProps) {
  const remaining = Math.max(0, expiresAt - Date.now())
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)

  // Against 30 minutes, which is what `warmModel` asks for. A model loaded by something
  // else carries the daemon's 5-minute default and so opens most of the way spent —
  // which is the honest picture, and the reason that case is worth warning about.
  const fraction = Math.min(1, remaining / (30 * 60_000))

  return (
    <section className="border-b border-line px-3 py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="eyebrow text-ash">Stays loaded for</h3>
        <span className="ml-auto tabular-nums text-bone">
          {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
        </span>
      </div>
      <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${fraction < 0.07 ? 'bg-rust' : 'bg-patina'}`}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </span>
    </section>
  )
}

/**
 * Props for {@link Window}.
 */
interface WindowProps {
  /** What the context window holds. */
  report: ContextReport
}

/**
 * The context window, and where the number came from.
 *
 * The provenance is the point. `/api/show` reports a model's architectural maximum, not
 * what the daemon sized it to, so a window Pi Taster had to fall back on is usually much
 * smaller than the model advertises — and believing the larger number means Ollama
 * truncates the head of the prompt with no error and no event.
 */
function Window({ report }: WindowProps) {
  return (
    <section className="px-3 py-3">
      <h3 className="eyebrow pb-1.5 text-ash">Context window</h3>
      <Row label="Serves" value={formatTokens(report.window)} />
      <Row label="Summarizes at" value={formatTokens(report.compactAt)} />
      <p className="mt-1.5 text-[11px] text-ash">{describeSource(report.windowSource)}</p>
    </section>
  )
}

/**
 * One sentence on where the window figure came from.
 * @param source - Provenance of the figure
 * @returns A short clause
 */
function describeSource(source: ContextReport['windowSource']): string {
  switch (source) {
    case 'user':
      return 'Set in Settings, overriding what the daemon reports.'
    case 'daemon':
      return 'Reported by the daemon for the resident model.'
    case 'fallback':
      // Deliberately about what Pi Taster knows, not about what the daemon is doing.
      // The figure falls back whenever no session has warmed the model *in this run*,
      // which includes the case where the daemon is holding it perfectly happily — and
      // this block sits directly under a line saying the model is resident, so wording
      // it as a claim about the daemon puts two contradictory sentences on one screen.
      return 'A conservative default — Pi Taster has not read a window figure from the daemon for this model. The real one is measured when the next turn warms it.'
  }
}

/**
 * Props for {@link Row}.
 */
interface RowProps {
  /** What the figure is. */
  label: string
  /** The figure. */
  value: string
}

/**
 * One label-and-figure line.
 */
function Row({ label, value }: RowProps) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[11px]">
      <span className="text-ash">{label}</span>
      <span className="ml-auto tabular-nums text-bone">{value}</span>
    </div>
  )
}
