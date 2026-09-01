/**
 * Relative timestamps, and the day buckets a list groups them into.
 *
 * Three components were carrying their own copy of the same formatter. It lives
 * here so a change to how the app talks about time reaches all of them.
 */

/** Milliseconds in each unit the formatter steps through. */
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const WEEK = 604_800_000

/**
 * Format a timestamp as time elapsed since it.
 * @param iso - An ISO timestamp
 * @returns A short phrase such as `just now`, `4m ago`, or a locale date
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()

  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`
  return date.toLocaleDateString()
}

/**
 * Format a timestamp for a dense row that already sits under a day heading.
 *
 * The heading carries the day, so the row only needs the distance within it —
 * dropping "ago" keeps a right-aligned column narrow and scannable.
 *
 * @param iso - An ISO timestamp
 * @returns A short measure such as `now`, `4m`, `3h`, or a locale date
 */
export function formatCompactTime(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()

  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`
  return date.toLocaleDateString()
}

/** A bucket of days, used as a heading over a list sorted by recency. */
export type DayBucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Earlier'

/** The buckets in the order a recency-sorted list produces them. */
export const DAY_BUCKETS: readonly DayBucket[] = [
  'Today',
  'Yesterday',
  'Previous 7 days',
  'Earlier'
]

/**
 * Which day bucket a timestamp falls into.
 *
 * Bucketed by calendar day rather than by elapsed hours, because "yesterday" is
 * what the reader means: something from 11pm last night is yesterday at 9am, not
 * ten hours ago.
 *
 * @param iso - An ISO timestamp
 * @returns The bucket the timestamp belongs to
 */
export function dayBucketOf(iso: string): DayBucket {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Earlier'

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  // Both ends are midnight, so this is a whole number of days apart — rounded
  // rather than floored because a DST boundary makes one of them 23 or 25 hours.
  const daysAgo = Math.round((startOfToday.getTime() - startOfDay.getTime()) / DAY)

  // Negative days means later today — a clock skew, or a timestamp from the future.
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return 'Previous 7 days'
  return 'Earlier'
}
