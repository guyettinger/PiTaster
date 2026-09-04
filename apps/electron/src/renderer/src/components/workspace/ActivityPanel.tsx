/**
 * Every provider request this conversation has made, and what each one cost.
 */

import { SplitBar } from '../charts/SplitBar'
import { VERDICT_TONES, VerdictRibbon } from '../charts/VerdictRibbon'
import { formatDuration, formatRate, formatTokens } from '../../lib/measures'
import { useTelemetry } from '../../hooks/useTelemetry'
import type { ProviderRequestRecord, TelemetrySnapshot } from '../../types/electron'

/**
 * The session's requests, in full.
 *
 * The measurement has existed since Session 25 and has never been visible: the recorder
 * kept sixty-four requests with their prefill, decode, tokens and cache verdict, and the
 * UI drew one line summarizing the most recent turn. This is where the rest of it goes.
 *
 * The reuse figure at the top is the one worth watching. A healthy session reuses almost
 * everything it has already sent — that is what the sealed prefix is for — and a session
 * that does not is paying a full re-prefill it has no reason to.
 */
export function ActivityPanel() {
  const telemetry = useTelemetry()

  if (!telemetry || telemetry.requests.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-ash">
          Nothing measured yet. Send a message and this fills in as the requests land.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      {/* The totals are label-and-value pairs and want a measure; the request rows
          are fixed-width columns and want whatever width they are given. */}
      <div className="max-w-md">
        <Totals telemetry={telemetry} />
      </div>
      <RequestTable requests={telemetry.requests} />
    </div>
  )
}

/**
 * Props for {@link Totals}.
 */
interface TotalsProps {
  /** The reading. */
  telemetry: TelemetrySnapshot
}

/**
 * What the session has cost so far.
 */
function Totals({ telemetry }: TotalsProps) {
  const { totals } = telemetry
  const prompt = totals.prefilledTokens + totals.cachedTokens
  const reuse = prompt > 0 ? Math.round((totals.cachedTokens / prompt) * 100) : 0

  return (
    <section className="border-b border-line px-3 py-3">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow text-ash">Prompt tokens</span>
        <span className="ml-auto tabular-nums text-bone">{formatTokens(prompt)}</span>
      </div>

      {/* Reused against prefilled. The single mark that says whether the prefix cache
          is doing its job, and the reason the whole recorder exists. */}
      <div className="mt-1.5">
        <SplitBar
          width="100%"
          height={6}
          parts={[
            { id: 'cached', value: totals.cachedTokens, tone: 'bg-patina' },
            { id: 'prefilled', value: totals.prefilledTokens, tone: 'bg-brass' }
          ]}
          label="Reused against prefilled prompt tokens"
        />
      </div>
      <p className="mt-1 text-[11px] text-ash">
        <span className="text-patina">{formatTokens(totals.cachedTokens)} reused</span> ·{' '}
        <span className="text-brass">{formatTokens(totals.prefilledTokens)} prefilled</span> ·{' '}
        {reuse}% of the prompt came back
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Figure label="Requests" value={String(totals.requests)} />
        <Figure label="Generated" value={formatTokens(totals.outputTokens)} />
        <Figure label="Spent prefilling" value={formatDuration(totals.prefillMs)} />
        <Figure label="Prefill rate" value={formatRate(telemetry.prefillRate) ?? 'no sample'} />
        <Figure label="Decode rate" value={formatRate(telemetry.decodeRate) ?? 'no sample'} />
        <Figure
          label="Re-prefills"
          value={`${totals.invalidations + totals.compactions}`}
          tone={totals.invalidations > 0 ? 'text-rust' : undefined}
        />
      </dl>

      {totals.invalidations > 0 && (
        <p className="mt-2 text-[11px] text-rust">
          {totals.invalidations} request{totals.invalidations === 1 ? '' : 's'} re-prefilled a
          prefix the daemon already held. Something rewrote history that had been sent.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <VerdictRibbon verdicts={telemetry.requests.map((record) => record.cache)} limit={64} />
      </div>
    </section>
  )
}

/**
 * Props for {@link Figure}.
 */
interface FigureProps {
  /** What the number is. */
  label: string
  /** The number. */
  value: string
  /** Static Tailwind text colour, when the value earns one. */
  tone?: string
}

/**
 * One label-and-number pair in the totals grid.
 */
function Figure({ label, value, tone = 'text-bone' }: FigureProps) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ash">{label}</dt>
      <dd className={`ml-auto tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}

/**
 * Props for {@link RequestTable}.
 */
interface RequestTableProps {
  /** The recorded requests, oldest first. */
  requests: readonly ProviderRequestRecord[]
}

/**
 * Every recorded request, newest first.
 *
 * Newest first because the question anyone opens this panel with is about the turn that
 * just happened; the recorder keeps its buffer oldest-first because that is the order
 * the rates are taken over.
 */
function RequestTable({ requests }: RequestTableProps) {
  // The bars are comparative, so they are scaled against the slowest request on screen
  // rather than an absolute ceiling — a session of fast requests should still show
  // which of them was the slow one.
  const slowest = requests.reduce((most, record) => Math.max(most, record.totalMs ?? 0), 0)

  return (
    <section>
      <h3 className="eyebrow px-3 pb-1 pt-2.5 text-ash">Requests</h3>
      <ul className="pb-2">
        {[...requests].reverse().map((record) => (
          <RequestRow key={record.index} record={record} slowest={slowest} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Props for {@link RequestRow}.
 */
interface RequestRowProps {
  /** The request. */
  record: ProviderRequestRecord
  /** Wall time of the slowest request on screen, for scaling the bar. */
  slowest: number
}

/**
 * One request: what it cost, and what the daemon did with its prefix.
 */
function RequestRow({ record, slowest }: RequestRowProps) {
  const verdict = VERDICT_TONES[record.cache]
  const decodeMs = Math.max(0, (record.totalMs ?? 0) - (record.prefillMs ?? 0))

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors hover:bg-raised/60">
      <span className="w-7 shrink-0 tabular-nums text-ash">#{record.index}</span>

      <SplitBar
        width={120}
        full={slowest}
        parts={[
          { id: 'prefill', value: record.prefillMs ?? 0, tone: 'bg-brass' },
          { id: 'decode', value: decodeMs, tone: 'bg-brass/40' }
        ]}
        label={`Request ${record.index}: prefill and decode`}
      />

      <span className="w-14 shrink-0 text-right tabular-nums text-bone">
        {record.totalMs === null ? '—' : formatDuration(record.totalMs)}
      </span>

      <span className="w-20 shrink-0 text-right tabular-nums text-ash">
        {record.promptTokens === null ? '—' : `${formatTokens(record.promptTokens)} in`}
      </span>

      <span className="w-16 shrink-0 text-right tabular-nums text-ash">
        {record.outputTokens === null ? '—' : `${formatTokens(record.outputTokens)} out`}
      </span>

      <span
        aria-hidden
        title={verdict.label}
        className={`h-2 w-2 shrink-0 rounded-[2px] ${verdict.fill}`}
      />
      {record.outcome !== 'ok' && (
        <span className="shrink-0 text-[10.5px] text-ash">{record.outcome}</span>
      )}
    </li>
  )
}
