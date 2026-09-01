/**
 * Token estimation for skill text.
 */

/**
 * Rough characters per token.
 *
 * The same conservative heuristic `agent/context-trim.ts` uses, and the one Pi's own
 * compaction estimator uses. These numbers are shown to the user to make the cost of a
 * skill comparable — between skills, and against the context meter — so being off by a
 * little matters less than every number in the UI being off by the *same* little.
 */
const CHARS_PER_TOKEN = 4

/**
 * Estimate the tokens a piece of text costs.
 * @param text - The text to measure
 * @returns An estimated token count, never negative
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
