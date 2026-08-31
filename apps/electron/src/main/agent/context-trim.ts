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
 */
const TRUNCATION_MARKER = '…[anyapp truncated'

/** Sentinel identifying a read this module has already collapsed. */
const SUPERSEDED_MARKER = '[anyapp: superseded by a later read of'

/**
 * Tools whose results the trimmer will shorten.
 *
 * Deliberately not `edit` or `write`: their results are short already, and they are
 * the record of what the agent changed.
 */
const TRUNCATABLE_TOOLS = new Set(['read', 'bash', 'grep', 'find', 'ls', 'web_fetch'])

/**
 * Options for {@link trimContext}.
 */
export interface TrimContextOptions {
  /** Tokens above which one tool result is truncated. */
  maxToolResultTokens: number
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
 * Estimate a string's token cost.
 * @param text - The text to measure
 * @returns Approximate tokens
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Index of the last user message, which is where the current turn begins.
 *
 * Everything from there on is the agent's most recent action and is never trimmed:
 * the model has to see what it just did in full, or it repeats it.
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
 * Map every tool call id to the `path` argument it was given.
 *
 * A tool result carries its tool name but not its arguments — those live on the
 * assistant message that requested it — so recognising two reads of the same file
 * means walking the calls first.
 *
 * @param messages - The conversation
 * @returns Tool call id to path, for the calls that took one
 */
function collectCallPaths(messages: AgentMessage[]): Map<string, string> {
  const paths = new Map<string, string>()

  for (const message of messages) {
    if (!hasRole(message) || message.role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      const call = block as { type?: unknown; id?: unknown; arguments?: unknown }
      if (call.type !== 'toolCall' || typeof call.id !== 'string') continue
      const path = (call.arguments as { path?: unknown } | undefined)?.path
      if (typeof path === 'string') paths.set(call.id, path)
    }
  }

  return paths
}

/**
 * Find the last tool result id for each path a `read` was issued against.
 * @param messages - The conversation
 * @param callPaths - Tool call id to path
 * @returns The surviving tool call id per path
 */
function collectLatestReads(
  messages: AgentMessage[],
  callPaths: Map<string, string>
): Map<string, string> {
  const latest = new Map<string, string>()

  for (const message of messages) {
    if (!hasRole(message) || message.role !== 'toolResult') continue
    const result = message as { toolName?: unknown; toolCallId?: unknown; isError?: unknown }
    if (result.toolName !== READ_TOOL || result.isError === true) continue
    if (typeof result.toolCallId !== 'string') continue

    const path = callPaths.get(result.toolCallId)
    if (path) latest.set(path, result.toolCallId)
  }

  return latest
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
 * Truncate one tool result's text to fit the budget.
 *
 * The marker names how much was dropped and how to get it back, so the model can
 * re-read deliberately rather than guessing that the file ended early.
 *
 * @param text - The full result text
 * @param maxTokens - The budget in tokens
 * @returns The text, truncated with a marker when it was too long
 */
function truncateResult(text: string, maxTokens: number): string {
  if (text.includes(TRUNCATION_MARKER)) return text

  const limit = maxTokens * CHARS_PER_TOKEN
  if (text.length <= limit) return text

  const kept = text.slice(0, limit)
  const droppedLines = text.slice(limit).split('\n').length

  return `${kept}\n\n${TRUNCATION_MARKER} ${droppedLines} more lines to fit the context window. Re-read with offset and limit if you need them.]`
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
  if (!content.some((block) => (block as { type?: unknown }).type === 'image')) {
    return message
  }

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
 * Applied in order, and never to the system prompt, a user message, or anything in
 * the current turn:
 *
 * 1. Earlier `read` results for a path the agent has since re-read are replaced by a
 *    pointer to the newer one. Small models re-read constantly, and this is usually
 *    the largest single saving.
 * 2. Long tool results are truncated with a marker saying how to recover the rest.
 * 3. Screenshots older than {@link IMAGE_RETENTION_TURNS} turns become placeholders.
 *
 * @param messages - The conversation Pi is about to send
 * @param options - The tool-result budget
 * @returns The messages to send instead
 */
export function trimContext(
  messages: AgentMessage[],
  options: TrimContextOptions
): AgentMessage[] {
  const currentTurnStart = findCurrentTurnStart(messages)
  const callPaths = collectCallPaths(messages)
  const latestReads = collectLatestReads(messages, callPaths)

  // Count user messages from the end, so "the last two turns" is well defined.
  const userIndices: number[] = []
  for (let index = messages.length - 1; index >= 0 && userIndices.length <= IMAGE_RETENTION_TURNS; index -= 1) {
    const message = messages[index]
    if (hasRole(message) && message.role === 'user') userIndices.push(index)
  }
  const imageCutoff = userIndices.length > IMAGE_RETENTION_TURNS ? userIndices[IMAGE_RETENTION_TURNS] : -1

  return messages.map((message, index) => {
    if (!hasRole(message)) return message

    // The current turn is what the agent just did. Trimming it makes the model
    // repeat work, which is the failure this whole module exists to avoid.
    if (index >= currentTurnStart) return message

    if (message.role === 'user') {
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

    const path =
      typeof result.toolCallId === 'string' ? callPaths.get(result.toolCallId) : undefined

    // A failed read is never "superseded": `collectLatestReads` skips errors, so
    // without this check the newest read — the one that just failed — would be
    // replaced by a pointer to the older successful one, and the model would treat
    // stale contents as current.
    if (
      result.toolName === READ_TOOL &&
      result.isError !== true &&
      path !== undefined &&
      typeof result.toolCallId === 'string' &&
      latestReads.get(path) !== result.toolCallId
    ) {
      return withText(message, `${SUPERSEDED_MARKER} ${path}]`)
    }

    if (!TRUNCATABLE_TOOLS.has(result.toolName)) return message

    const text = renderContent(result.content)
    const truncated = truncateResult(text, options.maxToolResultTokens)
    return truncated === text ? message : withText(message, truncated)
  })
}

/**
 * Estimate the tokens a conversation occupies, for logging and tests.
 * @param messages - The conversation
 * @returns Approximate tokens
 */
export function estimateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => {
    const content = (message as { content?: unknown }).content
    return total + estimateTokens(renderContent(content))
  }, 0)
}
