import { GaugeCard, GaugePopover } from './GaugePopover'
import { formatRate } from '../lib/measures'
import { formatTokens } from './ContextBreakdown'
import type { ContextReport, DaemonHealth, TelemetrySnapshot } from '../types/electron'

/**
 * How close to being unloaded a model has to be before it is worth saying.
 *
 * `warmModel` asks for 30 minutes, but a model loaded by anything else carries the
 * daemon's 5-minute default — so this fires on the case that actually costs something:
 * a model about to be evicted under a person who is still working.
 */
const UNLOAD_WARNING_MS = 2 * 60 * 1000

/**
 * How the daemon gauge reads.
 */
export interface DaemonReading {
  /** Static Tailwind text colour for the label. */
  tone: string
  /** Static Tailwind fill for the dot. */
  dot: string
  /** What the gauge says. */
  label: string
  /** Whether this is a fault rather than a resting state. */
  isFault: boolean
  /** The full sentence, for the card and the accessible name. */
  detail: string
}

/**
 * What the gauge reads, and in what colour.
 *
 * **A fault replaces the resting label rather than adding a line.** The instrument row
 * has a fixed height — that is the whole point of it, since a composer that grows and
 * shrinks moves the box you are typing into — so the escalating sentence the old strip
 * used is not available. But a colour alone would leave someone whose turn just failed
 * with nothing to read unless they happened to hover, and the reason `DaemonHealthStrip`
 * existed at all was that health was checked in Settings, which is the one place a
 * person is not looking when a turn fails to start. So the fault takes the label's
 * space: same height, still legible without a pointer.
 *
 * @param health - The last reading, or null before there is one
 * @param model - The selected model's id
 * @returns What to draw
 */
export function describeDaemon(health: DaemonHealth | null, model: string): DaemonReading {
  const name = model.length > 0 ? model : 'no model selected'

  // Null is *unknown*, and must not render as healthy. Settings used to initialise its
  // own flag to `true` and so opened claiming Ollama was running, including when it
  // was not.
  if (health === null) {
    return {
      tone: 'text-ash',
      dot: 'bg-line',
      label: name,
      isFault: false,
      detail: 'Checking whether the daemon is answering…'
    }
  }

  if (!health.reachable) {
    return {
      tone: 'text-rust',
      dot: 'bg-rust',
      label: 'Ollama not answering',
      isFault: true,
      detail: 'Ollama is not answering. The next turn will fail until the daemon is running.'
    }
  }

  if (health.modelLoaded === false) {
    return {
      tone: 'text-brass',
      dot: 'bg-brass',
      label: 'model not loaded',
      isFault: true,
      detail: 'The model is not loaded. The next turn pays a full model load before it starts.'
    }
  }

  const remaining = health.expiresAt === null ? null : health.expiresAt - Date.now()

  if (remaining !== null && remaining <= 0) {
    return {
      tone: 'text-brass',
      dot: 'bg-brass',
      label: 'model unloaded',
      isFault: true,
      detail: 'The model has been unloaded. The next turn pays a full model load before it starts.'
    }
  }

  if (remaining !== null && remaining <= UNLOAD_WARNING_MS) {
    const seconds = Math.max(1, Math.round(remaining / 1000))
    return {
      tone: 'text-brass',
      dot: 'bg-brass',
      label: `unloads in ${seconds}s`,
      isFault: true,
      detail: `Ollama unloads the model in ${seconds}s — the next turn after that pays a full model load.`
    }
  }

  return {
    tone: 'text-ash',
    dot: 'bg-patina',
    label: name,
    isFault: false,
    detail: 'The daemon is answering and the model is resident.'
  }
}

/**
 * Props for the DaemonGauge component.
 */
export interface DaemonGaugeProps {
  /** The last health reading, or null before there is one. */
  health: DaemonHealth | null
  /** The selected model's id. */
  model: string
  /** What the window holds, for the window figure and its provenance. */
  report: ContextReport | null
  /** The session's measured rates, or null before the first read. */
  telemetry: TelemetrySnapshot | null
  /** Open the Daemon panel. */
  onOpenPanel: () => void
}

/**
 * The local daemon, in one gauge.
 */
export function DaemonGauge({
  health,
  model,
  report,
  telemetry,
  onOpenPanel
}: DaemonGaugeProps) {
  const reading = describeDaemon(health, model)

  return (
    <GaugePopover label={`Daemon: ${reading.detail}`} trigger={
      <>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${reading.dot}`} />
        <span className={`max-w-[10rem] truncate ${reading.tone}`}>{reading.label}</span>
      </>
    }>
{(close) => (
        <GaugeCard width="w-[20rem]">
          <div className="px-3">
            <p className={reading.isFault ? 'text-rust' : 'text-bone'}>{reading.detail}</p>
            <p className="mt-1 truncate font-mono text-[10.5px] text-ash">{model || '—'}</p>
          </div>

          <div className="mt-3 space-y-0.5 px-3">
            <Row label="Context window" value={report ? formatTokens(report.window) : '—'} />
            <Row label="Prefill" value={formatRate(telemetry?.prefillRate ?? null) ?? 'not measured yet'} />
            <Row label="Decode" value={formatRate(telemetry?.decodeRate ?? null) ?? 'not measured yet'} />
          </div>

          <div className="mt-3 border-t border-line px-3 pt-2">
            <button
              onClick={() => {
                close()
                onOpenPanel()
              }}
              className="rounded px-2 py-1 text-ash transition-colors hover:bg-raised hover:text-bone"
            >
              Open Daemon →
            </button>
          </div>
        </GaugeCard>
      )}
    </GaugePopover>
  )
}

/**
 * Props for one line of a gauge card's figures.
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
    <div className="flex items-baseline gap-2">
      <span className="text-ash">{label}</span>
      <span className="ml-auto tabular-nums text-bone">{value}</span>
    </div>
  )
}
