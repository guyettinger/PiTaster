/**
 * What the daemon did with the prefix, one cell per request.
 */

import type { CacheVerdict } from '../../types/electron'

/**
 * How each verdict draws.
 *
 * `reused` is the state anyapp works to keep and is deliberately the quietest — a
 * healthy session should not decorate itself. `invalidated` is the one worth a colour,
 * because it is anyapp having re-sent a prompt the daemon already held.
 *
 * Static class names, never constructed: Tailwind's scanner never sees a built one.
 */
export const VERDICT_TONES: Record<CacheVerdict, VerdictTone> = {
  reused: { fill: 'bg-patina', text: 'text-patina', label: 'prefix reused' },
  cold: { fill: 'bg-ash/50', text: 'text-ash', label: 'cold prefill' },
  compacted: {
    fill: 'bg-brass/70',
    text: 'text-ash',
    label: 're-prefilled after summarizing'
  },
  invalidated: {
    fill: 'bg-rust',
    text: 'text-rust',
    label: 're-prefilled — history was rewritten'
  },
  unknown: { fill: 'bg-line', text: 'text-ash', label: 'cache not reported' }
}

/**
 * How one verdict draws, in both registers it is needed in.
 *
 * The fill and the text colour are stated separately rather than derived from each
 * other. Tailwind's scanner never sees a constructed class name, so a `bg-patina` bent
 * into a `text-patina` at runtime is a colour that silently does not exist.
 */
export interface VerdictTone {
  /** Static Tailwind fill, for a cell or a bar. */
  fill: string
  /** Static Tailwind text colour, for a label. */
  text: string
  /** What the verdict means, in words. */
  label: string
}

/**
 * Props for the VerdictRibbon component.
 */
export interface VerdictRibbonProps {
  /** The verdicts, oldest first. */
  verdicts: readonly CacheVerdict[]
  /** How many of the most recent to draw. */
  limit?: number
  /** Cell height, in pixels. */
  height?: number
}

/**
 * A session's cache history as a strip of cells.
 *
 * The cheapest possible read of the one thing the sealed-prefix work is for: a healthy
 * session is a solid run of patina, and a rewrite is a rust cell you can find without
 * reading a single number.
 */
export function VerdictRibbon({ verdicts, limit = 24, height = 6 }: VerdictRibbonProps) {
  const window = verdicts.slice(-limit)
  if (window.length === 0) return null

  return (
    <span className="flex shrink-0 gap-px overflow-hidden rounded-[1px]" style={{ height }}>
      {window.map((verdict, index) => (
        // Position is the identity: this is the last N requests in order, redrawn
        // whole whenever the run moves.
        <span
          key={index}
          title={VERDICT_TONES[verdict].label}
          className={`w-1.5 ${VERDICT_TONES[verdict].fill}`}
          style={{ height }}
        />
      ))}
    </span>
  )
}
