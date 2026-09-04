import { ActivityGauge } from './ActivityGauge'
import { ChangedFilesStrip } from './ChangedFilesStrip'
import { ContextMeter } from './ContextMeter'
import { DaemonGauge } from './DaemonGauge'
import type { AgentActivity } from '../state/agentActivity'
import type { SessionChanges } from '../hooks/useSessionChanges'
import type {
  ContextReport,
  DaemonHealth,
  TelemetrySnapshot
} from '../types/electron'

/**
 * Props for the AgentGaugeRow component.
 */
export interface AgentGaugeRowProps {
  /** What the agent is doing. */
  activity: AgentActivity
  /** The session's measured requests, or null before the first read. */
  telemetry: TelemetrySnapshot | null
  /** The last daemon reading, or null before there is one. */
  health: DaemonHealth | null
  /** The selected model's id. */
  model: string
  /** What the context window holds, or null before the first read. */
  report: ContextReport | null
  /** What this session has changed, as git sees it. */
  changes: SessionChanges
  /** Summarize the conversation now. */
  onCompact: () => void
  /** Whether a manual compaction is running. */
  isCompacting: boolean
  /** The last compaction failure, or null. */
  compactError: string | null
  /** Open the Skills page. */
  onOpenSkills: () => void
  /** Open a file in its own Code panel. */
  onOpenFile: (path: string) => void
  /** Open one of the instrument panels. */
  onOpenPanel: (panel: 'activity' | 'daemon' | 'changes') => void
}

/**
 * Four gauges, above the box you type into.
 *
 * This replaces four strips that were each designed alone and stacked badly:
 * `DaemonHealthStrip`, `AgentStatusStrip`, `TurnSummaryStrip` and the old
 * `ChangedFilesStrip`. Worst case they cost four lines above the composer, and because
 * every one of them rendered conditionally **the input box moved** — a warning arrived,
 * a turn ended, a file was written, and the target you were aiming at shifted.
 *
 * So the rule this row exists to keep is that its height never changes. Every gauge
 * renders always; a gauge with nothing to say says so, dimmed, rather than
 * disappearing and taking its neighbours' positions with it. Nothing here escalates
 * into a second line — a fault takes over its own gauge's label instead, which is why
 * `describeDaemon` returns a label rather than a colour alone.
 *
 * The detail lives in the cards, and behind them in three dockable panels. The gauges
 * are a summary you can read without stopping, which is the only thing that fits in a
 * row you look at while typing.
 */
export function AgentGaugeRow({
  activity,
  telemetry,
  health,
  model,
  report,
  changes,
  onCompact,
  isCompacting,
  compactError,
  onOpenSkills,
  onOpenFile,
  onOpenPanel
}: AgentGaugeRowProps) {
  return (
    <div className="mx-auto mb-2 flex h-6 max-w-3xl items-center gap-1 text-[11px] text-ash">
      <ActivityGauge
        activity={activity}
        telemetry={telemetry}
        onOpenPanel={() => onOpenPanel('activity')}
      />

      <DaemonGauge
        health={health}
        model={model}
        report={report}
        telemetry={telemetry}
        onOpenPanel={() => onOpenPanel('daemon')}
      />

      {/* Pushed right, with the two gauges that answer "what is this costing me" —
          the window and the diff — beside each other rather than at opposite ends. */}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <ContextMeter
          report={report}
          onOpenSkills={onOpenSkills}
          onCompact={onCompact}
          isCompacting={isCompacting}
          error={compactError}
        />

        <ChangedFilesStrip
          patches={changes.patches}
          committedPaths={changes.committedPaths}
          uncommitted={changes.uncommitted}
          pendingPaths={activity.pendingPaths}
          writingPath={activity.writingPath}
          onOpenFile={onOpenFile}
          onOpenPanel={() => onOpenPanel('changes')}
        />
      </div>
    </div>
  )
}
