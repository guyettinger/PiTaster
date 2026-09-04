/**
 * A run of measurements as bars, small enough to sit inside a gauge.
 */

/** Width of one bar, in pixels. */
const BAR_WIDTH = 3

/** Gap between bars, in pixels. */
const BAR_GAP = 1

/**
 * Shortest bar a non-zero value may draw, as a fraction of the tallest.
 *
 * The same rule `StatBar` states for a diffstat: a fast request beside a very slow one
 * would round to nothing, and a value that measured something must not look like a
 * value that measured zero.
 */
const FLOOR = 0.12

/**
 * Props for the Sparkline component.
 */
export interface SparklineProps {
  /** The measurements, oldest first. A null is a gap, not a zero. */
  values: readonly (number | null)[]
  /** How many of the most recent to draw. */
  limit?: number
  /** Bar height at full scale, in pixels. */
  height?: number
  /** Static Tailwind fill for the bars. */
  tone?: string
  /** Accessible description, e.g. `Recent request times`. */
  label?: string
}

/**
 * Recent measurements, at a glance.
 *
 * Scaled against the tallest value in the window rather than an absolute ceiling: the
 * question a sparkline in a gauge answers is *is this turn like the last few*, which
 * is comparative. An absolute scale would flatten a whole session of fast requests
 * into one indistinguishable line.
 *
 * Draws nothing at all when every value is missing. A row of floor-height bars for a
 * series that measured nothing is a chart asserting a shape it does not have.
 */
export function Sparkline({
  values,
  limit = 12,
  height = 10,
  tone = 'bg-ash',
  label
}: SparklineProps) {
  const window = values.slice(-limit)
  const measured = window.filter((value): value is number => value !== null)
  if (measured.length === 0) return null

  const tallest = Math.max(...measured)

  return (
    <span
      role="img"
      aria-label={label}
      className="flex shrink-0 items-end"
      style={{ height, gap: BAR_GAP }}
    >
      {window.map((value, index) => (
        <span
          // Position is the identity here: these are the last N requests, and the run
          // is redrawn whole whenever it moves.
          key={index}
          className={`rounded-[1px] ${value === null ? 'bg-line' : tone}`}
          style={{
            width: BAR_WIDTH,
            height:
              value === null
                ? 1
                : Math.max(1, Math.round(scale(value, tallest) * height))
          }}
        />
      ))}
    </span>
  )
}

/**
 * A value's share of the tallest, with a floor so a small one still draws.
 * @param value - The measurement
 * @param tallest - The largest measurement in the window
 * @returns A fraction between the floor and 1
 */
export function scale(value: number, tallest: number): number {
  if (tallest <= 0) return value > 0 ? 1 : 0
  if (value <= 0) return 0
  return Math.max(FLOOR, value / tallest)
}
