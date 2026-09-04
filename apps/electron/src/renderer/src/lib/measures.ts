/**
 * How the instrument row renders the numbers it is given.
 *
 * One module because the gauges and their panels must agree: two roundings of the same
 * number that disagree by a hundred tokens read as a bug in the measurement, which is
 * the reason `formatTokens` was exported from the context breakdown in the first
 * place. It is re-exported here so a gauge needs one import rather than a reach into
 * an unrelated component.
 */

export { formatTokens } from '../components/ContextBreakdown'

/**
 * Render a duration the way a person waiting reads one.
 *
 * Sub-second durations keep a decimal, because the difference between 0.2s and 0.9s is
 * the difference between a cached prefix and a missed one and rounding both to `1s`
 * hides exactly what the gauge is for.
 *
 * @param ms - The duration
 * @returns A short string, e.g. `0.4s`, `43s` or `3m12s`
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`

  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * Render a measured rate.
 * @param rate - Tokens per second, or null before there is a sample
 * @returns A short string, or null when there is nothing measured
 */
export function formatRate(rate: number | null): string | null {
  if (rate === null || rate <= 0) return null
  return `${rate >= 100 ? Math.round(rate) : Number(rate.toFixed(1))} tok/s`
}

/**
 * How long a prefill of this many tokens would take, at the measured rate.
 *
 * Null before there is a sample, because a rate invented from a constant would be the
 * same mistake as Ollama's advertised context window: a plausible number nobody
 * measured.
 *
 * @param tokens - The prompt size to price
 * @param rate - Measured prefill rate in tokens per second
 * @returns A short phrase, or null when there is no measurement
 */
export function formatPrefillTime(tokens: number, rate: number | null): string | null {
  if (rate === null || rate <= 0 || tokens <= 0) return null

  const seconds = Math.round(tokens / rate)
  if (seconds < 60) return `~${seconds}s`
  return `~${Math.round(seconds / 60)} min`
}
