import { ContextBreakdown, formatTokens } from './ContextBreakdown'
import { GaugePopover } from './GaugePopover'
import type { ContextReport } from '../types/electron'

/** Fraction of the window past which the meter reads as a warning rather than a fact. */
const CROWDED = 0.85

/**
 * Props for the {@link ContextMeter} component.
 */
export interface ContextMeterProps {
  /** What the window holds, or null before the first read settles. */
  report: ContextReport | null
  /** Open the Skills page. */
  onOpenSkills: () => void
  /** Summarize the conversation now. */
  onCompact: () => void
  /** Whether a manual compaction is running. */
  isCompacting: boolean
  /** The last compaction failure, or null. */
  error: string | null
}

/**
 * How full the context window is, and what is filling it.
 *
 * This used to be hidden more often than it was shown. It read a number that existed
 * only after a completed turn, and the agent host that answered for it was torn down on
 * an app switch, a session switch, and every skills, sources or config save — so the
 * meter blinked out several times a minute during ordinary use, and was absent entirely
 * until the first turn of a session finished with the chat panel open.
 *
 * It now renders unconditionally, because main can always answer: the fixed half of a
 * request is a pure function of the app and its configuration. The only thing that
 * varies is how much of the number is measured, which the card says out loud.
 *
 * Its hover-and-pin behaviour was the first of its kind in the app and is now
 * {@link GaugePopover}, shared by every gauge in the instrument row.
 */
export function ContextMeter({
  report,
  onOpenSkills,
  onCompact,
  isCompacting,
  error
}: ContextMeterProps) {
  const total = report ? (report.measured ?? report.estimated) : 0
  const fraction = report ? Math.min(1, total / Math.max(1, report.window)) : 0

  // `stale` and `floor` are honest but not current, so the meter recedes rather than
  // asserting. Crowding is the one thing worth shouting about.
  const dim = report === null || report.state === 'stale' || report.state === 'floor'
  const fill = fraction > CROWDED ? 'bg-rust' : dim ? 'bg-ash' : 'bg-keylime'

  return (
    <GaugePopover
      hasCard={report !== null}
      label={
        report
          ? `Context: ${total.toLocaleString()} of ${report.window.toLocaleString()} tokens`
          : 'Context usage'
      }
      trigger={
        <>
          <span aria-hidden className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-line">
            <span
              className={`block h-full rounded-full ${fill}`}
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </span>
          <span className={`shrink-0 tabular-nums ${dim ? 'opacity-60' : ''}`}>
            {report
              ? `${report.state === 'estimated' ? '~' : ''}${formatTokens(total)} / ${formatTokens(report.window)}`
              : '— / —'}
          </span>
        </>
      }
    >
      {(close) =>
        report && (
        <ContextBreakdown
          report={report}
          onOpenSkills={() => {
            close()
            onOpenSkills()
          }}
          onCompact={onCompact}
          isCompacting={isCompacting}
          error={error}
        />
        )
      }
    </GaugePopover>
  )
}
