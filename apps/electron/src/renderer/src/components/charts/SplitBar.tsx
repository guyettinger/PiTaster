/**
 * One measurement split into its parts, drawn the way `git diff --stat` draws churn.
 */

/**
 * Props for the SplitBar component.
 */
export interface SplitBarProps {
  /** The parts, in draw order. A part of zero is skipped rather than drawn hairline. */
  parts: readonly SplitBarPart[]
  /** The value a full-width bar represents. Defaults to the sum of the parts. */
  full?: number
  /**
   * Bar width at full scale.
   *
   * A number is pixels, for a bar sitting in a row of fixed columns. A string is
   * passed through, so `'100%'` fills whatever the bar is placed in — which a large
   * pixel number does not do: it overflows the container instead of stretching to it.
   */
  width?: number | string
  /** Bar height, in pixels. */
  height?: number
  /** Accessible description. */
  label?: string
}

/**
 * One segment of a {@link SplitBar}.
 */
export interface SplitBarPart {
  /** Stable key. */
  id: string
  /** The part's size, in the bar's own units. */
  value: number
  /** Static Tailwind fill. */
  tone: string
}

/**
 * A measurement's parts, side by side and to scale.
 *
 * Two questions in one mark: how big this measurement is against the largest in its
 * group, which is the bar's *length*, and what it was made of, which is the split. A
 * request's prefill against its decode is the case this exists for — the ratio is what
 * says whether a slow turn was the daemon thinking or the daemon reading.
 */
export function SplitBar({ parts, full, width = 64, height = 4, label }: SplitBarProps) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  if (total <= 0) return null

  const ceiling = full && full > 0 ? full : total
  const extent = Math.min(1, total / ceiling)

  return (
    <span
      role="img"
      aria-label={label}
      className="block shrink-0 overflow-hidden rounded-[1px] bg-line"
      style={{ width, height }}
    >
      <span className="flex h-full" style={{ width: `${extent * 100}%` }}>
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.id}
              className={part.tone}
              style={{ width: `${(part.value / total) * 100}%` }}
            />
          ))}
      </span>
    </span>
  )
}
