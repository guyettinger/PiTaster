import { GaugeCard, GaugePopover } from './GaugePopover'
import { Sparkline } from './charts/Sparkline'
import { VERDICT_TONES, VerdictRibbon } from './charts/VerdictRibbon'
import { SplitBar } from './charts/SplitBar'
import { formatDuration, formatTokens } from '../lib/measures'
import type { AgentActivity } from '../state/agentActivity'
import type { AgentStatus, TelemetrySnapshot } from '../types/electron'

/**
 * How each kind of wait reads.
 *
 * The dot's colour is the whole point of reading `kind`: compaction, a failed request
 * being retried, and a long prefill are three different situations with three
 * different right responses, and they used to render identically. `retrying` is the
 * one that earns a warning colour — it means something already went wrong.
 */
const STATUS_TONES: Record<AgentStatus['kind'], { tone: string; fallback: string }> = {
  compacting: { tone: 'bg-brass', fallback: 'Summarizing…' },
  retrying: { tone: 'bg-rust', fallback: 'Retrying…' },
  waiting: { tone: 'bg-ash', fallback: 'Waiting on the model…' },
  settled: { tone: 'bg-patina', fallback: 'Working…' }
}

/**
 * What the activity gauge reads.
 */
export interface ActivityReading {
  /** Static Tailwind fill for the dot. */
  dot: string
  /** Whether the dot pulses, which is what says a turn is still running. */
  pulse: boolean
  /** What the gauge says. */
  label: string
  /** The full sentence, for the accessible name. */
  detail: string
  /** Whether there is anything behind the gauge worth opening a card for. */
  hasCard: boolean
}

/**
 * What the gauge reads in each of the three states it has.
 *
 * Streaming is the state that matters most and the one the old strips served worst: a
 * compaction, a retry and an ordinary long prefill rendered as the same pulsing
 * ellipsis, and the status was not even cleared on an error, so the strip went on
 * saying "…retrying" after the run it described had failed.
 *
 * A finished turn with no measured request shows nothing. That is deliberate and
 * inherited: an aborted run, or a daemon that reported no usage, produces a summary of
 * zero, and a summary of zero is worse than no summary.
 *
 * @param activity - What the agent is doing
 * @param telemetry - The session's measured requests, or null before the first read
 * @returns What to draw
 */
export function summarizeActivity(
  activity: AgentActivity,
  telemetry: TelemetrySnapshot | null
): ActivityReading {
  const hasHistory = (telemetry?.requests.length ?? 0) > 0

  if (activity.isStreaming) {
    const status = activity.status
    const kind = status?.kind ?? 'settled'
    const { tone, fallback } = STATUS_TONES[kind] ?? STATUS_TONES.waiting
    const attempt =
      status?.attempt && status.maxAttempts ? ` (${status.attempt} of ${status.maxAttempts})` : ''
    const label = `${status?.detail ?? fallback}${attempt}`

    return { dot: tone, pulse: true, label, detail: label, hasCard: hasHistory }
  }

  const finished = activity.lastTurn
  if (finished && finished.turn.requests > 0) {
    const verdict = VERDICT_TONES[finished.cache]
    return {
      dot: finished.cache === 'invalidated' ? 'bg-rust' : 'bg-ash',
      pulse: false,
      label: formatDuration(finished.turn.elapsedMs),
      detail: `Last turn: ${finished.turn.requests} request${
        finished.turn.requests === 1 ? '' : 's'
      }, ${formatDuration(finished.turn.elapsedMs)}, ${verdict.label}`,
      hasCard: true
    }
  }

  return {
    dot: 'bg-line',
    pulse: false,
    label: hasHistory ? 'idle' : '—',
    detail: hasHistory ? 'Idle. The last turn reported no measured request.' : 'No turns yet.',
    hasCard: hasHistory
  }
}

/**
 * Props for the ActivityGauge component.
 */
export interface ActivityGaugeProps {
  /** What the agent is doing. */
  activity: AgentActivity
  /** The session's measured requests, or null before the first read. */
  telemetry: TelemetrySnapshot | null
  /** Open the Activity panel. */
  onOpenPanel: () => void
}

/**
 * What the agent is doing, and what the last turn cost.
 *
 * Two strips used to share this slot — one for the wait, one for the bill — and the
 * swap between them was itself a layout change. They are one gauge now because they
 * are one question asked at two moments.
 */
export function ActivityGauge({ activity, telemetry, onOpenPanel }: ActivityGaugeProps) {
  const reading = summarizeActivity(activity, telemetry)
  const requests = telemetry?.requests ?? []
  const finished = activity.lastTurn

  return (
    <GaugePopover label={`Activity: ${reading.detail}`} hasCard={reading.hasCard} trigger={
      <>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${reading.dot} ${
            reading.pulse ? 'animate-pulse' : ''
          }`}
        />
        <span className="min-w-0 truncate">{reading.label}</span>
        {!activity.isStreaming && (
          <Sparkline
            values={requests.map((record) => record.totalMs)}
            label="Recent request times"
          />
        )}
      </>
    }>
{(close) => (
        <GaugeCard>
          <div className="px-3">
            <span className="eyebrow text-ash">Last turn</span>
            {finished && finished.turn.requests > 0 ? (
              <>
                <p className="mt-1 text-bone">
                  {finished.turn.requests} request{finished.turn.requests === 1 ? '' : 's'} ·{' '}
                  {formatDuration(finished.turn.elapsedMs)}
                </p>
                <p className="mt-0.5 text-ash">
                  {formatTokens(finished.turn.promptTokens)} prompt
                  {finished.turn.prefilledTokens < finished.turn.promptTokens && (
                    <span> ({formatTokens(finished.turn.prefilledTokens)} prefilled)</span>
                  )}{' '}
                  · {formatTokens(finished.turn.outputTokens)} out
                </p>
                <p className={`mt-0.5 ${VERDICT_TONES[finished.cache].text}`}>
                  {VERDICT_TONES[finished.cache].label}
                </p>
              </>
            ) : (
              <p className="mt-1 text-ash">No measured request yet.</p>
            )}
          </div>

          {requests.length > 0 && (
            <div className="mt-3 px-3">
              <div className="flex items-baseline gap-2">
                <span className="eyebrow text-ash">Recent requests</span>
                <span className="ml-auto text-ash">prefill · decode</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {requests.slice(-6).map((record) => (
                  <div key={record.index} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 tabular-nums text-ash">#{record.index}</span>
                    <SplitBar
                      width={140}
                      parts={[
                        { id: 'prefill', value: record.prefillMs ?? 0, tone: 'bg-brass' },
                        {
                          id: 'decode',
                          value: Math.max(0, (record.totalMs ?? 0) - (record.prefillMs ?? 0)),
                          tone: 'bg-brass/40'
                        }
                      ]}
                      label={`Request ${record.index}`}
                    />
                    <span className="ml-auto shrink-0 tabular-nums text-ash">
                      {record.totalMs === null ? '—' : formatDuration(record.totalMs)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <VerdictRibbon verdicts={requests.map((record) => record.cache)} />
                <span className="ml-auto text-ash">prefix history</span>
              </div>
            </div>
          )}

          <div className="mt-3 border-t border-line px-3 pt-2">
            <button
              onClick={() => {
                close()
                onOpenPanel()
              }}
              className="rounded px-2 py-1 text-ash transition-colors hover:bg-raised hover:text-bone"
            >
              Open Activity →
            </button>
          </div>
        </GaugeCard>
      )}
    </GaugePopover>
  )
}
