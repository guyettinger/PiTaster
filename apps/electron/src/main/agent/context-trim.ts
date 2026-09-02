/**
 * Shapes what reaches the model, without changing what is stored.
 *
 * Registered on Pi's `context` extension hook, which hands over the message list
 * before each provider request and accepts a replacement. Nothing here touches the
 * JSONL transcript, git history, or the chat UI — those keep the whole conversation.
 * This only decides what is worth spending a small context window on.
 *
 * Everything is a pure transform of the message list so it can be tested directly.
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
 * Turns of history whose screenshots are kept.
 *
 * An element-context screenshot is worth roughly 1.2k tokens and is almost never
 * relevant two turns after it was attached — by then the agent is editing code, not
 * looking at pixels.
 */
const IMAGE_RETENTION_TURNS = 2

/** Tool whose repeated results supersede one another. */
const READ_TOOL = 'read'

/**
 * Sentinel identifying text this module has already shortened.
 *
 * The hook runs before every provider request, so a result is seen many times. The
 * marker makes the transform idempotent — without it each pass truncates the previous
 * pass's output and reports a smaller, wrong number of dropped lines.
 *
 * Matched against the *last line* only. A substring test over the whole result would
 * exempt any file that happens to contain this sentence.
 */
const TRUNCATION_MARKER = '…[anyapp truncated'

/** Sentinel identifying a read this module has already collapsed. */
const SUPERSEDED_MARKER = '[anyapp: superseded by a later read of'

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
 * Tools bounded only by {@link TrimContextOptions.hardToolResultTokens}.
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
 * Options for {@link trimContext}.
 */
export interface TrimContextOptions {
  /** Tokens above which one tool result is truncated, in history. */
  maxToolResultTokens: number
  /**
   * Tokens above which one tool result is truncated even in the current turn.
   *
   * Much larger than {@link maxToolResultTokens}, and a different kind of judgement —
   * see the note in {@link trimContext}.
   */
  hardToolResultTokens: number
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
 * Replace a tool result's content, leaving every other field alone.
 * @param message - The tool result message
 * @param text - The replacement text
 * @returns A new message carrying only that text
 */
function withText(message: AgentMessage, text: string): AgentMessage {
  return { ...(message as object), content: [{ type: 'text', text }] } as AgentMessage
}

/**
 * Whether this module has already shortened a result.
 *
 * Only the last line is examined. The old test looked for the marker anywhere, which
 * exempted any file whose contents happened to quote it.
 *
 * @param text - The result text
 * @returns True when the text ends with a truncation marker
 */
function isAlreadyTruncated(text: string): boolean {
  return text.slice(text.lastIndexOf('\n') + 1).startsWith(TRUNCATION_MARKER)
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
 * Strip images from a message's content, leaving a placeholder in their place.
 * @param message - The message to strip
 * @returns The message, or a copy with images replaced
 */
function stripImages(message: AgentMessage): AgentMessage {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return message
  if (!content.some((block) => (block as { type?: unknown }).type === 'image')) return message

  const stripped = content.map((block) =>
    (block as { type?: unknown }).type === 'image'
      ? { type: 'text', text: '[screenshot omitted — it is older than the last few turns]' }
      : block
  )

  return { ...(message as object), content: stripped } as AgentMessage
}

/**
 * Reduce a conversation to what is worth sending to a small-context model.
 *
 * Applied in order, and never to the system prompt or a user message:
 *
 * 1. A `read` whose every line a later read has since returned is replaced by a
 *    pointer to the newer one. Small models re-read constantly, and this is usually
 *    the largest single saving. Skipped inside the current turn.
 * 2. Long tool results are truncated with a marker saying how to resume.
 * 3. Screenshots older than {@link IMAGE_RETENTION_TURNS} turns become placeholders.
 *
 * The current turn is what the agent just did. Dropping it as *irrelevant* makes the
 * model repeat work, which is the failure this module exists to avoid — so the
 * supersede and screenshot rules stop at the turn boundary, and so does the ordinary
 * size cap. What does not stop there is `hardToolResultTokens`: past that a single
 * result cannot coexist with the rest of the prompt even after a compaction, so the
 * request fails whatever we do, and it fails as an unexplained timeout rather than as
 * an oversized tool result. Truncating is strictly better than that. The two
 * thresholds are an order of magnitude apart and answer different questions — one is
 * "is this still worth its space", the other "can this request succeed at all".
 *
 * @param messages - The conversation Pi is about to send
 * @param options - The size budgets
 * @returns A new message list; the input is not modified
 */
export function trimContext(
  messages: AgentMessage[],
  options: TrimContextOptions
): AgentMessage[] {
  const currentTurnStart = findCurrentTurnStart(messages)
  const regions = collectCallRegions(messages)
  const superseded = collectSupersededReads(messages, regions)

  // Count user messages from the end, so "the last two turns" is well defined.
  const userIndices: number[] = []
  for (let index = messages.length - 1; index >= 0 && userIndices.length <= IMAGE_RETENTION_TURNS; index -= 1) {
    const message = messages[index]
    if (hasRole(message) && message.role === 'user') userIndices.push(index)
  }
  const imageCutoff = userIndices.length > IMAGE_RETENTION_TURNS ? userIndices[IMAGE_RETENTION_TURNS] : -1

  return messages.map((message, index) => {
    if (!hasRole(message)) return message

    const inCurrentTurn = index >= currentTurnStart

    if (message.role === 'user') {
      if (inCurrentTurn) return message
      return index <= imageCutoff ? stripImages(message) : message
    }

    if (message.role !== 'toolResult') return message

    const result = message as {
      toolName?: unknown
      toolCallId?: unknown
      content?: unknown
      isError?: unknown
    }
    if (typeof result.toolName !== 'string') return message

    const region =
      typeof result.toolCallId === 'string' ? regions.get(result.toolCallId) : undefined

    // A failed read is never "superseded": `collectSupersededReads` skips errors, so
    // without that filter the newest read — the one that just failed — could be
    // replaced by a pointer to an older successful one, and the model would treat
    // stale contents as current.
    if (
      !inCurrentTurn &&
      typeof result.toolCallId === 'string' &&
      superseded.has(result.toolCallId) &&
      region !== undefined
    ) {
      return withText(message, `${SUPERSEDED_MARKER} ${region.path}${describeRegion(region)}]`)
    }

    const hardCapOnly = HARD_CAP_ONLY_TOOLS.has(result.toolName)
    if (!hardCapOnly && !TRUNCATABLE_TOOLS.has(result.toolName)) return message

    const text = renderContent(result.content)
    const truncated = truncateResult({
      text,
      maxTokens:
        hardCapOnly || inCurrentTurn
          ? options.hardToolResultTokens
          : options.maxToolResultTokens,
      startLine: result.toolName === READ_TOOL ? region?.start : undefined
    })
    return truncated === text ? message : withText(message, truncated)
  })
}
