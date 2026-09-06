/**
 * Freezes history so the prompt sent to the daemon is append-only.
 *
 * Ollama caches the KV state of a prompt prefix, which makes a resend of a stable
 * prefix nearly free: 133.5s to prefill 11431 tokens cold, 0.24s to resend the same
 * bytes. Rewriting one early message put it back to 124.4s. Prefill dominates a turn
 * on a local model, so the byte-for-byte stability of the prefix is worth far more
 * than the tokens a cleverer trim would save.
 *
 * The invariant: **once a byte has been sent to the daemon it does not change until a
 * deliberate, rare reset.** Every rule below therefore runs at a *seal*, which
 * advances only when enough untrimmed history has accumulated to be worth one cache
 * invalidation — instead of running per request, which is what the previous design
 * did and why it re-prefilled the whole window on essentially every turn.
 *
 * Sealing is a permanent decision, so it is **written into Pi's own message objects**
 * rather than applied as a per-request transform. That is what makes Pi's compaction
 * check see the trimmed size: it estimates over `agent.state.messages`, and a
 * transform that only shapes the outgoing request can never relieve compaction
 * pressure. It is safe for four reasons, each verified against Pi 0.84.4:
 *
 * - `SessionManager` entries hold the *same* message objects, and
 *   `sessionEntryToContextMessages` hands them straight back, so a mutation survives
 *   the rebuild that compaction and branching do (`session-manager.js:166-176`).
 * - The JSONL transcript is written when a message is appended, so a mutation
 *   afterwards cannot rewrite it. Nothing inside the current turn is ever sealed,
 *   which is what keeps that true — see {@link sealTarget}.
 * - Key Lime Pi's chat UI reads the transcript from disk through its own `SessionManager`,
 *   never this list, so the conversation a person sees keeps everything.
 * - Pi mutates messages in place itself, for the same reason
 *   (`agent-session.js:453-460`).
 *
 * What may *not* do this is the `context` hook: Pi hands it `structuredClone(messages)`
 * (`extensions/runner.js:793`), so a write there reaches a copy and nothing else. The
 * hook is passed the live list by its caller instead.
 */

import type { ContextEvent } from '@earendil-works/pi-coding-agent'

/**
 * One message as Pi hands it to the `context` hook.
 *
 * Read off the hook's own event rather than imported from `pi-agent-core`, which is
 * only a transitive dependency here — and this way the type follows Pi if it changes.
 */
export type AgentMessage = ContextEvent['messages'][number]

/**
 * Rough characters per token.
 *
 * Pi's own compaction estimator uses the same conservative heuristic. Being wrong by
 * a little only shifts where truncation lands.
 */
const CHARS_PER_TOKEN = 4

/**
 * Tokens charged for one image when deciding whether to advance the seal.
 *
 * An estimate, and only ever used to answer "has enough accumulated to be worth a
 * cache invalidation" — never shown to anyone as a price. Pi bills an image at a flat
 * character count Key Lime Pi has no business restating; `agent/context-report.ts` recovers
 * that number by difference where it matters.
 */
const IMAGE_TOKENS = 1200

/** Tool whose repeated results supersede one another. */
const READ_TOOL = 'read'

/**
 * Sentinel identifying text this module has already shortened.
 *
 * A seal pass re-walks everything it has sealed before, so a result is seen many
 * times. The marker makes the transform idempotent — without it each pass truncates
 * the previous pass's output and reports a smaller, wrong number of dropped lines.
 *
 * Matched against the *last line* only. A substring test over the whole result would
 * exempt any file that happens to contain this sentence.
 */
const TRUNCATION_MARKER = '…[Key Lime Pi truncated'

/**
 * The same sentinel under every previous name, newest first.
 *
 * This is not tidiness, it is a correctness requirement. The marker is written into
 * Pi's *stored* messages — that is what lets compaction see a seal — and those
 * messages are restored from disk when a session resumes. A conversation sealed
 * before a rename therefore carries that era's prefix forever, and a check that only
 * knew the current one would fail to recognise its own work: the next seal pass would
 * truncate an already-truncated result and report a smaller, wrong number of dropped
 * lines. Idempotency is the whole contract of this module, so every old prefix stays
 * recognised permanently.
 *
 * There have been two renames — `anyapp` to Pi Taster, then Pi Taster to Key Lime Pi —
 * so this list grows by one entry each time and never shrinks. An install that skipped
 * a release can be carrying either.
 */
const LEGACY_TRUNCATION_MARKERS = ['…[Pi Taster truncated', '…[anyapp truncated']

/**
 * Sentinel identifying a read this module has already collapsed.
 *
 * Unlike {@link TRUNCATION_MARKER} this needs no legacy list: idempotence here is exact
 * equality against a freshly computed marker, not a prefix test, so a stored marker
 * written under an older name is simply rewritten once and then matches. The cost is one
 * prefix-cache invalidation on a resumed conversation's first seal after a rename, which
 * converges immediately — against a permanent list of dead names to carry.
 */
const SUPERSEDED_MARKER = '[Key Lime Pi: superseded by a later read of'

/**
 * Pi's own continuation notice, appended when its `read` tool truncates.
 *
 * `[Showing lines 12-2011 of 5400. Use offset=2012 to continue.]` — the one thing in
 * a read result that says where the agent got to. It is the last line, which is
 * exactly what a head-slice removes, so {@link truncateResult} parses it and rewrites
 * it for the shorter body rather than letting it be cut away.
 */
const PI_RESUME_FOOTER = /\[Showing lines (\d+)-\d+ of (\d+)[^\]]*\]\s*$/

/**
 * Tools whose results the trimmer will shorten.
 *
 * Deliberately not `edit` or `write`: their results are short already, and they are
 * the record of what the agent changed.
 *
 * `git_status` is here because it is unbounded in the one direction that matters.
 * `statusMatrix` reports untracked files as modified, so in an app without a
 * `.gitignore` it answers with every path under `node_modules/` — the case that
 * produced a 422 KB result against a 65k window. New sub-apps are seeded with a
 * `.gitignore`, but that is create-time only and does not reach existing apps.
 * `install_deps` is here for the same reason: it is what creates that `node_modules`,
 * and `bun install` output has no bound of its own either.
 *
 * This list is an allowlist, so anything not named here is exempt by default —
 * including the other version tools and every MCP tool.
 */
const TRUNCATABLE_TOOLS = new Set([
  'read',
  'bash',
  'grep',
  'find',
  'ls',
  'web_fetch',
  'git_status',
  'install_deps',
  // Evidence the agent gathered, like `read` and `grep` — a `references` result on a
  // widely-used symbol is exactly the kind of large, once-useful result these caps
  // exist for. `refactor` is deliberately absent: its result is the record of a write
  // that happened, and the same reasoning that keeps `edit` out keeps it out.
  'code_intel'
])

/**
 * Tools bounded only by {@link ContextSealOptions.hardToolResultTokens}.
 *
 * A loaded skill is not evidence the agent gathered, it is the instructions it is
 * working from — cutting it in history is cutting the model's own brief, and a model
 * that has lost half a procedure mid-task does something worse than repeat a `read`.
 * So the ordinary "is this still worth its space" cap does not apply to `load_skill`.
 *
 * The hard cap still does, because it answers a different question: past half the
 * window a single result cannot coexist with the system prompt and the surrounding
 * history, so the request fails either way — as an unexplained timeout rather than as
 * an oversized result. A skill that large is a skill worth splitting, and truncating it
 * says so where a timeout would not.
 */
const HARD_CAP_ONLY_TOOLS = new Set(['load_skill'])

/**
 * Options for {@link createContextSealer}.
 */
export interface ContextSealOptions {
  /** Tokens above which one sealed tool result is truncated. */
  maxToolResultTokens: number
  /**
   * Tokens above which one tool result is truncated even before it is sealed.
   *
   * Much larger than {@link maxToolResultTokens}, and a different kind of judgement —
   * see {@link ContextSealer.capForRequest}.
   */
  hardToolResultTokens: number
  /**
   * Tokens of new, untrimmed history carried before the seal advances.
   *
   * The cost of one advance is one cold prefill of the whole prompt. The cost of not
   * advancing is carrying that much untrimmed history in every request until it does.
   */
  sealAdvanceTokens: number
}

/**
 * Shapes what reaches the model across a whole session.
 */
export interface ContextSealer {
  /**
   * Freeze the history that can no longer change, in place.
   *
   * @param messages - Pi's live message list
   * @returns The number of messages this call rewrote
   */
  seal: (messages: AgentMessage[]) => number
  /**
   * Apply the request-viability cap, without changing what is stored.
   *
   * @param messages - Pi's live message list
   * @returns The list to send, sharing every message the cap left alone
   */
  capForRequest: (messages: AgentMessage[]) => AgentMessage[]
}

/**
 * The region of a file one `read` call asked for.
 *
 * Pi's `read` takes `offset` and `limit`, and its description tells the model to
 * "continue with offset until complete" on a large file. Two reads of one path are
 * therefore usually two *different* parts of it, which is why superseding compares
 * regions rather than paths.
 */
interface ReadRegion {
  /** The `path` argument, as the model gave it. */
  path: string
  /** First line read, 1-indexed. */
  start: number
  /** Last line read, 1-indexed; `Infinity` when the call set no `limit`. */
  end: number
}

/**
 * A message with a `role`, which is every LLM message but not every custom one.
 */
interface RoledMessage {
  /** The message's role. */
  role: string
}

/**
 * Narrow an agent message to one carrying a role.
 * @param message - The message to test
 * @returns True when the message has a string `role`
 */
function hasRole(message: AgentMessage): message is AgentMessage & RoledMessage {
  return typeof (message as { role?: unknown }).role === 'string'
}

/**
 * Index of the last user message, which is where the current turn begins.
 *
 * @param messages - The conversation
 * @returns The index the current turn starts at, or the length when there is none
 */
function findCurrentTurnStart(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (hasRole(message) && message.role === 'user') return index
  }
  return messages.length
}

/**
 * Read a positive integer argument, treating anything else as absent.
 * @param value - The raw argument
 * @returns The integer, or undefined
 */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

/**
 * Map every tool call id to the file region it asked for.
 *
 * A tool result carries its tool name but not its arguments — those live on the
 * assistant message that requested it — so recognising two reads of the same region
 * means walking the calls first.
 *
 * @param messages - The conversation
 * @returns Tool call id to region, for the calls that took a path
 */
function collectCallRegions(messages: AgentMessage[]): Map<string, ReadRegion> {
  const regions = new Map<string, ReadRegion>()

  for (const message of messages) {
    if (!hasRole(message) || message.role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      const call = block as { type?: unknown; id?: unknown; arguments?: unknown }
      if (call.type !== 'toolCall' || typeof call.id !== 'string') continue

      const args = call.arguments as
        | { path?: unknown; offset?: unknown; limit?: unknown }
        | undefined
      if (typeof args?.path !== 'string') continue

      // Pi's `read` defaults to line 1 and to the end of the file.
      const start = positiveInteger(args.offset) ?? 1
      const limit = positiveInteger(args.limit)
      regions.set(call.id, {
        path: args.path,
        start,
        end: limit === undefined ? Number.POSITIVE_INFINITY : start + limit - 1
      })
    }
  }

  return regions
}

/**
 * Whether one read's region contains another's.
 * @param outer - The candidate containing region
 * @param inner - The candidate contained region
 * @returns True when `outer` covers every line `inner` did
 */
function covers(outer: ReadRegion, inner: ReadRegion): boolean {
  return outer.path === inner.path && outer.start <= inner.start && outer.end >= inner.end
}

/**
 * Find the reads that a later read has made redundant.
 *
 * A read is redundant only when a *later* successful read of the same path covers
 * every line it returned. Two reads of disjoint regions — the pagination Pi's own
 * tool description asks for on a large file — are both kept, because between them
 * they are the only copy of that file the model has.
 *
 * @param messages - The conversation
 * @param regions - Tool call id to region
 * @returns The tool call ids whose results can be collapsed
 */
function collectSupersededReads(
  messages: AgentMessage[],
  regions: Map<string, ReadRegion>
): Set<string> {
  const reads: { callId: string; region: ReadRegion }[] = []

  for (const message of messages) {
    if (!hasRole(message) || message.role !== 'toolResult') continue
    const result = message as { toolName?: unknown; toolCallId?: unknown; isError?: unknown }
    if (result.toolName !== READ_TOOL || result.isError === true) continue
    if (typeof result.toolCallId !== 'string') continue

    const region = regions.get(result.toolCallId)
    if (region) reads.push({ callId: result.toolCallId, region })
  }

  const superseded = new Set<string>()
  for (let index = 0; index < reads.length; index += 1) {
    for (let later = index + 1; later < reads.length; later += 1) {
      if (covers(reads[later].region, reads[index].region)) {
        superseded.add(reads[index].callId)
        break
      }
    }
  }

  return superseded
}

/**
 * Name a region the way the marker should report it.
 * @param region - The region to describe
 * @returns A trailing phrase, empty for a whole-file read
 */
function describeRegion(region: ReadRegion): string {
  if (region.start === 1 && region.end === Number.POSITIVE_INFINITY) return ''
  const end = region.end === Number.POSITIVE_INFINITY ? 'end' : String(region.end)
  return ` lines ${region.start}-${end}`
}

/**
 * Whether this module has already shortened a result.
 *
 * Only the last line is examined. Looking for the marker anywhere would exempt any
 * file whose contents happened to quote it.
 *
 * @param text - The result text
 * @returns True when the text ends with a truncation marker
 */
function isAlreadyTruncated(text: string): boolean {
  const lastLine = text.slice(text.lastIndexOf('\n') + 1)
  return (
    lastLine.startsWith(TRUNCATION_MARKER) ||
    LEGACY_TRUNCATION_MARKERS.some((marker) => lastLine.startsWith(marker))
  )
}

/**
 * Count the lines in a string.
 * @param text - The text to measure
 * @returns The number of lines, zero for an empty string
 */
function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

/**
 * Cut a string to a character budget without splitting a line.
 *
 * Pi is careful never to return a partial line, and a truncated result that ends in
 * half a statement reads as a syntax error rather than as a cut.
 *
 * @param text - The text to cut
 * @param limit - The maximum length in characters
 * @returns The text, cut at the last line boundary within the limit
 */
function sliceWholeLines(text: string, limit: number): string {
  if (text.length <= limit) return text
  const boundary = text.lastIndexOf('\n', limit)
  // A single line longer than the whole budget has no boundary to cut on. Take the
  // raw slice rather than returning nothing at all.
  return boundary <= 0 ? text.slice(0, limit) : text.slice(0, boundary)
}

/**
 * Inputs to {@link truncateResult}.
 */
interface TruncateResultParams {
  /** The full result text. */
  text: string
  /** The budget in tokens. */
  maxTokens: number
  /** 1-indexed file line the result starts at, when it came from a `read`. */
  startLine?: number
}

/**
 * Truncate one tool result's text to fit the budget.
 *
 * The marker says how to recover the rest. Where the line numbers are known — from a
 * `read`'s own `offset`, or from Pi's continuation footer — it names the exact offset
 * to resume from, because Pi's read output carries no line numbers and a model that
 * is only told "some lines were dropped" has no way to work out where it got to.
 *
 * @param params - The text, the budget, and the starting line if known
 * @returns The text, truncated with a marker when it was too long
 */
function truncateResult(params: TruncateResultParams): string {
  const { text, maxTokens } = params
  if (isAlreadyTruncated(text)) return text

  const limit = maxTokens * CHARS_PER_TOKEN

  // Pi's footer is the last line, so lift it off before measuring and cutting. Its
  // numbers describe the untruncated body and are rewritten below.
  const footer = PI_RESUME_FOOTER.exec(text)
  const body = footer ? text.slice(0, footer.index).trimEnd() : text
  const startLine = footer ? Number(footer[1]) : params.startLine
  const totalLines = footer ? Number(footer[2]) : undefined

  if (body.length <= limit) return text

  const kept = sliceWholeLines(body, limit)
  const keptLines = countLines(kept)

  if (startLine !== undefined && keptLines > 0) {
    const lastKept = startLine + keptLines - 1
    const of = totalLines === undefined ? '' : ` of ${totalLines}`
    return (
      `${kept}\n\n${TRUNCATION_MARKER} to fit the context window. ` +
      `Showing lines ${startLine}-${lastKept}${of}. Use offset=${lastKept + 1} to continue.]`
    )
  }

  const droppedLines = countLines(body) - keptLines
  return (
    `${kept}\n\n${TRUNCATION_MARKER} ${droppedLines} more lines to fit the context ` +
    'window. Re-read with offset and limit if you need them.]'
  )
}

/**
 * Concatenate a tool result's text blocks, noting any images.
 * @param content - The result's content blocks
 * @returns The text, with images represented as placeholders
 */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      const typed = block as { type?: unknown; text?: unknown }
      if (typed.type === 'text' && typeof typed.text === 'string') return typed.text
      if (typed.type === 'image') return '[image]'
      return ''
    })
    .filter((part) => part.length > 0)
    .join('\n')
}

/**
 * Whether a message carries an image block.
 *
 * The seal writes its result back over the original, so a rule that flattens content
 * to a single text block would destroy an image permanently. No truncatable tool
 * returns one today; this is the guard that keeps that from becoming a silent data
 * loss the day one does.
 *
 * @param message - The message to test
 * @returns True when any content block is an image
 */
function carriesImage(message: AgentMessage): boolean {
  const content = (message as { content?: unknown }).content
  return (
    Array.isArray(content) &&
    content.some((block) => (block as { type?: unknown }).type === 'image')
  )
}

/**
 * Estimate what one message costs in the prompt.
 *
 * Only ever compared against {@link ContextSealOptions.sealAdvanceTokens} to decide
 * whether a seal has become worthwhile, so an approximation is the right instrument.
 *
 * @param message - The message to measure
 * @returns Estimated tokens
 */
function estimateMessageTokens(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return Math.ceil(content.length / CHARS_PER_TOKEN)
  if (!Array.isArray(content)) return 0

  let chars = 0
  let images = 0
  for (const block of content) {
    const typed = block as { type?: unknown; text?: unknown; arguments?: unknown }
    if (typed.type === 'image') {
      images += 1
      continue
    }
    if (typeof typed.text === 'string') chars += typed.text.length
    if (typed.type === 'toolCall') chars += JSON.stringify(typed.arguments ?? {}).length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS
}

/**
 * Estimate a range of the conversation.
 * @param messages - The conversation
 * @param end - Index to stop before
 * @returns Estimated tokens in `[0, end)`
 */
function estimateRange(messages: AgentMessage[], end: number): number {
  let total = 0
  for (let index = 0; index < end; index += 1) total += estimateMessageTokens(messages[index])
  return total
}

/**
 * Replace a message's content in place.
 *
 * In place, not by copy, because the point of a seal is that Pi's own stored message
 * carries the shortened text — that is what lets its compaction check see the real
 * size. See the module header for why this is safe.
 *
 * @param message - The message to rewrite
 * @param text - The replacement text
 */
function setText(message: AgentMessage, text: string): void {
  ;(message as { content: unknown }).content = [{ type: 'text', text }]
}

/**
 * Replace a message's content, leaving the original alone.
 * @param message - The message to copy
 * @param text - The replacement text
 * @returns A new message carrying only that text
 */
function withText(message: AgentMessage, text: string): AgentMessage {
  return { ...(message as object), content: [{ type: 'text', text }] } as AgentMessage
}

/**
 * Replace a message's images with a placeholder, in place.
 * @param message - The message to strip
 */
function stripImagesInPlace(message: AgentMessage): void {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return
  if (!content.some((block) => (block as { type?: unknown }).type === 'image')) return

  ;(message as { content: unknown }).content = content.map((block) =>
    (block as { type?: unknown }).type === 'image'
      ? { type: 'text', text: '[screenshot omitted — it is older than the last few turns]' }
      : block
  )
}

/**
 * How far the seal may advance: everything before the current turn.
 *
 * The current turn is what the agent just did, and an agent that cannot see that
 * repeats it — the reason the previous design exempted it too. Everything before it
 * is settled: no later evidence changes whether it is the current turn, and its
 * screenshots are stale by construction.
 *
 * It is also the line that makes writing back safe. `SessionManager` appends a
 * message's transcript entry when the message is created, so a message older than the
 * user message that opened this turn is long since on disk and mutating the object
 * cannot rewrite it.
 *
 * The one rule this does not settle is superseding, which stays open forever — any
 * later read might cover an earlier one. That saving is deliberately deferred to the
 * next advance rather than taken as soon as it appears, because taking it early is
 * exactly the per-turn prefix rewrite this module exists to stop.
 *
 * @param messages - The conversation
 * @returns The number of messages that may be sealed
 */
function sealTarget(messages: AgentMessage[]): number {
  const start = findCurrentTurnStart(messages)
  // No user message at all means no turn has begun, and nothing is old enough to
  // freeze. `findCurrentTurnStart` answers with the length in that case, which would
  // otherwise seal the whole list.
  return start >= messages.length ? 0 : start
}

/**
 * Build the sealer for one session.
 *
 * @param options - The size budgets and the seal threshold
 * @returns A sealer holding this session's seal position
 */
export function createContextSealer(options: ContextSealOptions): ContextSealer {
  /**
   * Estimated size of the sealable range as this sealer last left it.
   *
   * The trigger is how much has arrived since — not the range's absolute size, which
   * would fire the seal again on every request once the conversation was long enough.
   */
  let sealedTokens = 0

  const seal = (messages: AgentMessage[]): number => {
    const target = sealTarget(messages)
    if (target <= 0) return 0

    const sealable = estimateRange(messages, target)
    // Compaction and branching replace the history with something smaller, which
    // leaves the baseline above the range it describes. Re-anchor rather than wait
    // for the conversation to grow past a number that no longer means anything.
    if (sealable < sealedTokens) sealedTokens = sealable
    if (sealable - sealedTokens < options.sealAdvanceTokens) return 0

    const regions = collectCallRegions(messages)
    const superseded = collectSupersededReads(messages, regions)
    let rewritten = 0

    for (let index = 0; index < target; index += 1) {
      const message = messages[index]
      if (!hasRole(message)) continue

      if (message.role === 'user') {
        // A sealed user message is older than the current turn and the seal advances
        // rarely, so by the time this runs the screenshot is several turns old — long
        // past being about the code the agent is now editing. It is worth roughly 1.2k
        // tokens, which is a large share of a small window to spend on stale pixels.
        if (carriesImage(message)) {
          stripImagesInPlace(message)
          rewritten += 1
        }
        continue
      }
      if (message.role !== 'toolResult') continue

      const result = message as {
        toolName?: unknown
        toolCallId?: unknown
        content?: unknown
        isError?: unknown
      }
      if (typeof result.toolName !== 'string') continue

      const region =
        typeof result.toolCallId === 'string' ? regions.get(result.toolCallId) : undefined

      // A failed read is never "superseded": `collectSupersededReads` skips errors, so
      // without that filter the newest read — the one that just failed — could be
      // replaced by a pointer to an older successful one, and the model would treat
      // stale contents as current.
      if (
        typeof result.toolCallId === 'string' &&
        superseded.has(result.toolCallId) &&
        region !== undefined
      ) {
        const marker = `${SUPERSEDED_MARKER} ${region.path}${describeRegion(region)}]`
        if (renderContent(result.content) !== marker) {
          setText(message, marker)
          rewritten += 1
        }
        continue
      }

      const hardCapOnly = HARD_CAP_ONLY_TOOLS.has(result.toolName)
      if (!hardCapOnly && !TRUNCATABLE_TOOLS.has(result.toolName)) continue
      if (carriesImage(message)) continue

      const text = renderContent(result.content)
      const truncated = truncateResult({
        text,
        maxTokens: hardCapOnly ? options.hardToolResultTokens : options.maxToolResultTokens,
        startLine: result.toolName === READ_TOOL ? region?.start : undefined
      })
      if (truncated !== text) {
        setText(message, truncated)
        rewritten += 1
      }
    }

    sealedTokens = estimateRange(messages, target)
    return rewritten
  }

  const capForRequest = (messages: AgentMessage[]): AgentMessage[] =>
    messages.map((message) => {
      if (!hasRole(message) || message.role !== 'toolResult') return message

      const result = message as { toolName?: unknown; content?: unknown }
      if (typeof result.toolName !== 'string') return message
      if (
        !TRUNCATABLE_TOOLS.has(result.toolName) &&
        !HARD_CAP_ONLY_TOOLS.has(result.toolName)
      ) {
        return message
      }

      const text = renderContent(result.content)
      const truncated = truncateResult({ text, maxTokens: options.hardToolResultTokens })
      return truncated === text ? message : withText(message, truncated)
    })

  return { seal, capForRequest }
}
