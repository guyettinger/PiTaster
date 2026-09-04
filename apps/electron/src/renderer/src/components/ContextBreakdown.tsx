import type { ContextBlock, ContextReport } from '../types/electron'

/**
 * The fills, as static class names — Tailwind's scanner never sees a constructed one,
 * the same rule `PermissionModeControl` documents for its accent map.
 *
 * The palette is deliberately two families rather than eleven hues. `globals.css` states
 * the thesis: brass is the agent acting, patina is history, and nothing else in the UI is
 * saturated, which is what lets those two read. So the *fixed* half — the prompt, the
 * schemas, the manifest — is drawn in ash, receding; the *conversation* half is brass,
 * because it is the half the agent produced.
 *
 * Rank inside each family is carried by opacity, and assigned by **position**, not by
 * block id. Keyed by id, the second-largest block could draw in the palest tone the ramp
 * has, which reads as a bug in the measurement rather than as an identity. Blocks arrive
 * sorted, so index is rank.
 */
const FIXED_RAMP = ['bg-ash', 'bg-ash/80', 'bg-ash/65', 'bg-ash/50', 'bg-ash/40', 'bg-ash/30']

/** The conversation ramp. Same rule, brass. */
const CONVERSATION_RAMP = [
  'bg-brass',
  'bg-brass/80',
  'bg-brass/60',
  'bg-brass/45',
  'bg-brass/30'
]

/**
 * Assign every block its fill, once, so the bar and the legend cannot disagree.
 *
 * @param blocks - The report's blocks, already sorted within each group
 * @returns Block id to a static Tailwind class
 */
function assignFills(blocks: ContextBlock[]): Map<string, string> {
  const fills = new Map<string, string>()
  let fixed = 0
  let conversation = 0

  for (const block of blocks) {
    const ramp = block.group === 'fixed' ? FIXED_RAMP : CONVERSATION_RAMP
    const index = block.group === 'fixed' ? fixed++ : conversation++
    fills.set(block.id, ramp[Math.min(index, ramp.length - 1)])
  }

  return fills
}

/**
 * Render a token count the way a person reads one.
 *
 * Exported because the meter and its card must agree: two roundings of the same number
 * that disagree by a hundred tokens read as a bug in the measurement.
 *
 * @param value - A token count
 * @returns A short string, e.g. `8.4k`
 */
export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value))
  const thousands = value / 1000
  return `${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`
}

/**
 * One sentence on where the window number came from.
 *
 * The fallback case is the one worth saying out loud: Ollama's `/api/show` reports a
 * model's architectural maximum, not what the daemon sized it to, so a window anyapp had
 * to guess at is usually smaller than advertised.
 *
 * @param source - Provenance of the window figure
 * @returns A short clause for the header
 */
/**
 * How long a cold prefill of this much context would take, at the measured rate.
 *
 * The number that predicts how long the next turn takes, and the one a token count
 * alone hides: on the audited model a full window is about thirteen minutes of
 * prefill, and a comfortable-looking `31k / 65k` says nothing about that. It is what
 * a *miss* costs, not what the next turn will cost — anyapp works to keep the prefix
 * cached, and the sentence says so.
 *
 * Null before there is a sample, because a rate invented from a constant would be the
 * same mistake as the advertised context window: a plausible number nobody measured.
 *
 * @param tokens - The prompt size to price
 * @param rate - Measured prefill rate in tokens per second
 * @returns A short phrase, or null when there is no measurement
 */
function describePrefillTime(tokens: number, rate: number | null): string | null {
  if (rate === null || rate <= 0 || tokens <= 0) return null

  const seconds = Math.round(tokens / rate)
  if (seconds < 60) return `~${seconds}s to prefill if the cache misses`
  return `~${Math.round(seconds / 60)} min to prefill if the cache misses`
}

function describeSource(source: ContextReport['windowSource']): string {
  switch (source) {
    case 'user':
      return 'window set in Settings'
    case 'daemon':
      return 'window reported by the daemon'
    case 'fallback':
      return 'conservative default — the daemon has not loaded this model yet'
  }
}

/**
 * What the header says about how trustworthy the total is.
 *
 * The `floor` wording is careful. A cold launch resumes the previous transcript but has
 * no agent session to measure it with, so the report is the fixed cost alone — and
 * calling that "what this conversation starts at" would be a lie about a chat that
 * already has fifty turns in it. What is true in both cases is that the conversation is
 * counted from the next turn onward.
 *
 * @param state - How much of the report is measured
 * @returns A short clause, or null when the number needs no qualifying
 */
function describeState(state: ContextReport['state']): string | null {
  switch (state) {
    case 'live':
      return null
    case 'estimated':
      return 'estimated — the model has not reported usage since the last summary'
    case 'stale':
      return 'as of the last turn'
    case 'floor':
      return 'fixed cost only — the conversation is counted from the next turn'
  }
}

/**
 * Props for one legend row.
 */
interface BlockRowProps {
  /** The block to describe. */
  block: ContextBlock
  /** The block's fill, from {@link assignFills}. */
  fill: string
  /** The context window, for the percentage. */
  window: number
}

/**
 * One line of the legend: swatch, label, secondary text, tokens.
 */
function BlockRow({ block, fill, window }: BlockRowProps) {
  const percent = Math.round((block.tokens / Math.max(1, window)) * 100)

  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 translate-y-px rounded-[2px] ${fill}`}
      />
      <span className="truncate text-bone">{block.label}</span>
      {block.detail && <span className="shrink-0 text-ash">{block.detail}</span>}
      <span className="ml-auto shrink-0 tabular-nums text-ash">
        {percent > 0 ? `${percent}%` : '<1%'}
      </span>
      <span className="w-10 shrink-0 text-right tabular-nums text-bone">
        {formatTokens(block.tokens)}
      </span>
    </div>
  )
}

/**
 * Props for the {@link ContextBreakdown} component.
 */
export interface ContextBreakdownProps {
  /** What the window holds. */
  report: ContextReport
  /** Open the Skills page, so a manifest block can be acted on. */
  onOpenSkills: () => void
  /** Summarize the conversation now. */
  onCompact: () => void
  /** Whether a manual compaction is running. */
  isCompacting: boolean
  /** The last compaction failure, or null. */
  error: string | null
}

/**
 * What is taking up the context window, and what to do about it.
 *
 * Two registers, because they are worth different actions. **Fixed** is paid on every
 * single request and shrinks only by changing configuration — turning a skill off, using
 * the lean tool profile, trimming the app's `AGENTS.md`. **Conversation** grows with the
 * session and is cleared by compacting or starting a new chat. A single sorted list
 * would put a 1.9k skill manifest next to a 29k pile of tool results and imply they are
 * the same kind of problem.
 *
 * **The blocks are estimates and the total is not.** Pi anchors its number to the
 * provider's own accounting; everything here is chars/4. The footer states both rather
 * than scaling the blocks to close the gap, because a breakdown that always sums to the
 * measured total is a breakdown that has been made to.
 */
export function ContextBreakdown({
  report,
  onOpenSkills,
  onCompact,
  isCompacting,
  error
}: ContextBreakdownProps) {
  const total = report.measured ?? report.estimated
  const percent = Math.round((total / Math.max(1, report.window)) * 100)
  const qualifier = describeState(report.state)

  const fixed = report.blocks.filter((block) => block.group === 'fixed')
  const conversation = report.blocks.filter((block) => block.group === 'conversation')
  const sum = (blocks: ContextBlock[]): number =>
    blocks.reduce((running, block) => running + block.tokens, 0)

  // Summarizing needs a live session, which `stale` and `floor` are precisely the
  // states of not having. Offering the button there would answer a click with
  // `No conversation to compact yet`, which in `stale` is not even true — there is a
  // conversation, it is the session that is gone.
  const canCompact = report.state === 'live' || report.state === 'estimated'
  const fills = assignFills(report.blocks)
  const compactPercent = (report.compactAt / Math.max(1, report.window)) * 100
  const prefillTime = describePrefillTime(total, report.prefillRate)
  const showSeam = report.measured !== null && report.measured !== report.estimated

  return (
    <div className="w-[22rem] rounded-lg border border-line bg-panel py-3 text-[11px] shadow-lg">
      <div className="px-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tabular-nums text-bone">
            {formatTokens(total)} of {formatTokens(report.window)}
          </span>
          <span className="ml-auto tabular-nums text-ash">{percent}%</span>
        </div>
        <p className="mt-0.5 text-ash">
          {qualifier ? `${qualifier} · ` : ''}
          {describeSource(report.windowSource)}
        </p>

        {/* The window itself. The tick is the number the meter never showed and the
            whole reason a person watches this one: where the agent stops to summarize. */}
        <div className="relative mt-2.5 h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="flex h-full w-full">
            {report.blocks.map((block) => (
              <span
                key={block.id}
                className={fills.get(block.id)}
                style={{ width: `${(block.tokens / Math.max(1, report.window)) * 100}%` }}
              />
            ))}
          </div>
          <span
            aria-hidden
            className="absolute top-0 h-full w-px bg-rust"
            style={{ left: `${Math.min(100, compactPercent)}%` }}
          />
        </div>
        <p className="mt-1 text-ash">
          Summarizes at <span className="tabular-nums">{formatTokens(report.compactAt)}</span>
          {prefillTime && <span> · {prefillTime}</span>}
        </p>
      </div>

      <div className="mt-3 px-3">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow text-ash">Fixed</span>
          <span className="text-ash">every request</span>
          <span className="ml-auto tabular-nums text-bone">{formatTokens(sum(fixed))}</span>
        </div>
        <div className="mt-1">
          {fixed.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              fill={fills.get(block.id) ?? ''}
              window={report.window}
            />
          ))}
        </div>
      </div>

      {conversation.length > 0 && (
        <div className="mt-3 px-3">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow text-ash">Conversation</span>
            <span className="text-ash">cleared by summarizing</span>
            <span className="ml-auto tabular-nums text-bone">
              {formatTokens(sum(conversation))}
            </span>
          </div>
          <div className="mt-1">
            {conversation.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                fill={fills.get(block.id) ?? ''}
                window={report.window}
              />
            ))}
          </div>
        </div>
      )}

      {report.hotspots.length > 0 && (
        <div className="mt-3 border-t border-line px-3 pt-2">
          <span className="eyebrow text-ash">Largest results</span>
          <div className="mt-1">
            {report.hotspots.map((hotspot) => (
              <div key={hotspot.label} className="flex items-baseline gap-2 py-0.5">
                <span className="truncate font-mono text-[10px] text-bone">{hotspot.label}</span>
                <span className="ml-auto shrink-0 tabular-nums text-ash">
                  {formatTokens(hotspot.tokens)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-line px-3 pt-2">
        {showSeam && (
          <p className="text-ash">
            Measured <span className="tabular-nums">{formatTokens(report.measured ?? 0)}</span> ·
            blocks account for{' '}
            <span className="tabular-nums">{formatTokens(report.estimated)}</span>, estimated
          </p>
        )}
        {error && <p className="text-rust">{error}</p>}

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={onOpenSkills}
            className="rounded px-2 py-1 text-ash transition-colors hover:bg-raised hover:text-bone"
          >
            Manage skills →
          </button>
          <button
            onClick={onCompact}
            disabled={isCompacting || !canCompact}
            title={canCompact ? undefined : 'Send a message first — summarizing needs a live session.'}
            className="ml-auto rounded bg-raised px-2 py-1 text-bone transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isCompacting ? 'Summarizing…' : 'Summarize now'}
          </button>
        </div>
      </div>
    </div>
  )
}
