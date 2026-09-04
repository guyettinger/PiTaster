/**
 * What the turn that just finished cost, and what the daemon did with the prefix.
 */

import type { CacheVerdict, TurnCost } from '@anyapp/core'

/**
 * Props for the TurnSummaryStrip component.
 */
interface TurnSummaryStripProps {
  /** What the finished turn cost. */
  turn: TurnCost
  /** What the daemon did with the prefix on the turn's last request. */
  cache: CacheVerdict
}

/**
 * How each cache verdict reads, and what colour it earns.
 *
 * `reused` is the state anyapp works to keep and is deliberately the quietest: a
 * healthy turn should not decorate itself. `invalidated` is the one worth a colour,
 * because it is anyapp having re-sent a prompt the daemon already held — the defect
 * that went unnoticed for six sessions for want of exactly this line.
 */
const CACHE_LABELS: Record<CacheVerdict, { label: string; tone: string }> = {
  reused: { label: 'prefix reused', tone: 'text-patina' },
  cold: { label: 'cold prefill', tone: 'text-ash' },
  compacted: { label: 're-prefilled after summarizing', tone: 'text-ash' },
  invalidated: { label: 're-prefilled — history was rewritten', tone: 'text-rust' },
  unknown: { label: 'cache not reported', tone: 'text-ash' }
}

/**
 * Format a token count the way the context meter does.
 * @param tokens - The count
 * @returns A short string, e.g. `38.2k`
 */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

/**
 * Format a duration as minutes and seconds.
 * @param ms - Milliseconds
 * @returns A short string, e.g. `3m12s`
 */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * One line saying what the last turn cost.
 *
 * Prefill is most of the wall clock on a local model and none of it was visible: a
 * turn that re-sent 38k tokens the daemon already held looked exactly like one that
 * sent 27. The prefilled figure is given beside the prompt figure rather than instead
 * of it, because the gap between them *is* the saving.
 *
 * Nothing is shown for a turn with no measured request — an aborted run, or a daemon
 * that reported no usage. A summary of zero is worse than no summary.
 */
export function TurnSummaryStrip({ turn, cache }: TurnSummaryStripProps) {
  if (turn.requests === 0) return null

  const verdict = CACHE_LABELS[cache]
  const requests = `${turn.requests} request${turn.requests === 1 ? '' : 's'}`

  return (
    <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-baseline gap-x-2 text-[12px] text-ash">
      <span>{requests}</span>
      <span aria-hidden>·</span>
      <span>
        {formatTokens(turn.promptTokens)} prompt
        {turn.prefilledTokens < turn.promptTokens && (
          <span className="text-ash/70"> ({formatTokens(turn.prefilledTokens)} prefilled)</span>
        )}
      </span>
      <span aria-hidden>·</span>
      <span>{formatTokens(turn.outputTokens)} out</span>
      <span aria-hidden>·</span>
      <span>{formatDuration(turn.elapsedMs)}</span>
      <span aria-hidden>·</span>
      <span className={verdict.tone}>{verdict.label}</span>
    </div>
  )
}
