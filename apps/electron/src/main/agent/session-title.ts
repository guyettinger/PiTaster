/**
 * Naming a chat session from its first message, using the local model.
 *
 * This is an upgrade over the title the sidebar derives itself, never a
 * replacement for it. `ChatHistoryManager.listSessions` already falls back to the
 * first user message truncated to a line, so every failure here — a stopped
 * daemon, a timeout, a model that answers with a paragraph — costs nothing but the
 * nicer name. That is why every path returns null rather than throwing, and why
 * nothing is written unless the model produced something that survives validation.
 *
 * It is deliberately not a Pi tool and not part of the agent session. It runs once
 * per session, after a turn has completed, on Ollama's plain `/api/generate`.
 */

import { normalizeOllamaBaseUrl } from './ollama'

/**
 * How long to wait for a title before giving up.
 *
 * Short on purpose. The model is already resident by the time this runs, and a
 * title that takes longer than this is one the user has been looking at the
 * derived version of for long enough that replacing it would be a surprise.
 */
const TITLE_TIMEOUT_MS = 15_000

/** Keep the model resident, matching what the session warm-up asked for. */
const TITLE_KEEP_ALIVE = '30m'

/** Upper bound on the generated title, matching the manager's own truncation. */
const TITLE_MAX_CHARS = 60

/** Longest title worth accepting, in words. Past this the model is not summarizing. */
const TITLE_MAX_WORDS = 8

/** How much of the first message to send. A title does not need the whole prompt. */
const PROMPT_EXCERPT_CHARS = 800

/**
 * Tokens to allow the model. A 3-5 word title fits several times over.
 *
 * Generous rather than tight because a reasoning model that ignores `think: false`
 * spends its budget thinking before it says anything, and a title cut off mid-word
 * fails validation and costs the whole call.
 */
const TITLE_NUM_PREDICT = 64

/**
 * Parameters for {@link summarizeSessionTitle}.
 */
export interface SummarizeSessionTitleParams {
  /** Ollama daemon base URL, without the `/v1` suffix. */
  baseUrl: string
  /** Model tag to generate with. */
  modelId: string
  /** The session's first user message. */
  firstMessage: string
}

/**
 * Clean and validate what the model returned into something usable as a title.
 *
 * A small local model asked for a short title will variously return it wrapped in
 * quotes, followed by an explanation, prefixed with "Title:", or ignored entirely
 * in favour of answering the message. None of those should reach the sidebar, and
 * there is no way to tell a bad title from a good one after it has been written —
 * so anything not obviously a title is rejected here.
 *
 * @param raw - The model's raw response text
 * @returns A usable title, or null when the response was not one
 */
export function normalizeGeneratedTitle(raw: string): string | null {
  // A reasoning model that ignored `think: false` puts its reasoning first. An
  // unterminated block means the token budget ran out mid-thought, and there is no
  // title in there to find.
  if (/<think>/i.test(raw) && !/<\/think>/i.test(raw)) return null
  const spoken = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')

  // Only the first non-empty line. Anything after it is commentary.
  const firstLine = spoken
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return null

  let title = firstLine
    // Models trained to be helpful label their answer.
    .replace(/^(?:title|chat title|summary)\s*[:\-–—]\s*/i, '')
    // Surrounding quotes, straight or smart, and stray backticks.
    .replace(/^["'`“‘]+/, '')
    .replace(/["'`”’]+$/, '')
    // A title is not a sentence.
    .replace(/[.!?,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (title.length === 0) return null
  if (title.length > TITLE_MAX_CHARS) return null
  if (title.split(' ').length > TITLE_MAX_WORDS) return null
  // A response with no letter or digit is punctuation or an emoji, not a title.
  if (!/[\p{L}\p{N}]/u.test(title)) return null

  return title
}

/**
 * Ask the local model for a short title describing a session's first message.
 *
 * @param params - Daemon URL, model tag, and the message to summarize
 * @returns A validated title, or null when one could not be produced
 */
export async function summarizeSessionTitle(
  params: SummarizeSessionTitleParams
): Promise<string | null> {
  const { baseUrl, modelId, firstMessage } = params

  const excerpt = firstMessage.trim().slice(0, PROMPT_EXCERPT_CHARS)
  if (excerpt.length === 0) return null

  const prompt = [
    'Write a title of three to five words naming what this request is about.',
    'Reply with the title alone: no quotes, no punctuation at the end, no explanation.',
    '',
    'Request:',
    excerpt
  ].join('\n')

  /**
   * Post one generate request.
   * @param think - Value for Ollama's `think` field, or null to omit it
   * @returns The daemon's response
   */
  const generate = (think: boolean | null): Promise<Response> =>
    fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        prompt,
        stream: false,
        keep_alive: TITLE_KEEP_ALIVE,
        ...(think === null ? {} : { think }),
        options: { temperature: 0, num_predict: TITLE_NUM_PREDICT }
      }),
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
    })

  try {
    // `think: false` is what keeps a reasoning model from spending the whole token
    // budget before it says anything — but Ollama rejects the field outright on a
    // model that cannot think, so the retry covers the other half of the lineup.
    let response = await generate(false)
    if (!response.ok) {
      response = await generate(null)
    }
    if (!response.ok) return null

    const body: unknown = await response.json()
    const text =
      body && typeof body === 'object' && typeof (body as { response?: unknown }).response === 'string'
        ? (body as { response: string }).response
        : null
    if (text === null) return null

    return normalizeGeneratedTitle(text)
  } catch {
    // A stopped daemon, a timeout, or a model that does not exist. The derived
    // title already covers all three.
    return null
  }
}
