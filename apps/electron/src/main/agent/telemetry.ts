/**
 * Records what each provider request actually cost.
 *
 * Nothing in `apps/electron/src/main/agent/` measured the daemon before this. The
 * session had a stall notifier that formats an elapsed count into a sentence and
 * throws the number away, and a retry budget that watches for silence — no latency,
 * no throughput, no token counts, and no idea how many times a turn re-sent a prompt
 * the daemon had already prefilled. Session 25's audit found the trimmer destroying a
 * KV prefix cache worth ~500x on every turn boundary, and it took a standalone
 * benchmark to see it because the running app produced no number that would have.
 *
 * WHAT MAKES THIS CHEAP IS THAT OLLAMA ALREADY ANSWERS THE QUESTION. Its
 * OpenAI-compatible endpoint reports `prompt_tokens_details.cached_tokens`, and Pi's
 * `openai-completions` API maps it to `Usage.cacheRead` while subtracting it from
 * `Usage.input` (`pi-ai/dist/api/openai-completions.js:1175-1190`). So `input` is
 * exactly the prompt the daemon had to prefill and `cacheRead` is exactly what it
 * reused: prefix reuse is *measured*, not inferred from a suspiciously fast request.
 * That number has been arriving in every response since Session 15 with nothing
 * reading it.
 *
 * The clock comes from Pi's two provider hooks. Ollama sends no response headers
 * until the first token, so the gap between `before_provider_request` and
 * `after_provider_response` is the prefill — which is also why a long prefill dies as
 * a header timeout rather than as anything Pi can name (`agent/http-dispatcher.ts`).
 *
 * The recorder is fed entirely through its own methods and reads nothing else — no
 * daemon, no Pi session, an injectable clock — so every rule in it is testable
 * directly. The verdict and the formatting are pure functions beside it.
 */

import type {
  CacheVerdict,
  ProviderRequestRecord,
  RequestOutcome,
  TelemetrySnapshot,
  TelemetryTotals,
  TurnCost
} from '@anyapp/core'
import type { MessageEndEvent } from '@earendil-works/pi-coding-agent'

/**
 * One message as Pi hands it to the `message_end` hook.
 *
 * Read off the hook's own event rather than imported from `pi-agent-core`, which is
 * only a transitive dependency here — the same reasoning as `agent/context-trim.ts`.
 */
export type AgentMessage = MessageEndEvent['message']

/**
 * The token accounting Pi attaches to a finished assistant message.
 *
 * Narrowed off {@link AgentMessage} rather than imported, so a change to Pi's `Usage`
 * is a type error here instead of a silently wrong reading.
 */
export type ProviderUsage = Extract<AgentMessage, { role: 'assistant' }>['usage']

/**
 * How many requests are kept.
 *
 * Enough to show a session's recent shape and to take a stable median rate from,
 * small enough that the whole buffer can cross IPC without thought. Lifetime counts
 * live in {@link TelemetryTotals} precisely because this buffer forgets.
 */
const MAX_RECORDS = 64

/**
 * Smallest prefill worth deriving a rate from.
 *
 * Below this the fixed cost of the round trip dominates and the implied rate says
 * more about the daemon's overhead than about how fast it prefills.
 */
const MIN_RATE_SAMPLE_TOKENS = 512

/** Smallest generation worth deriving a decode rate from. */
const MIN_DECODE_SAMPLE_TOKENS = 16

/**
 * How far short of the previous prompt the reused prefix may fall and still count as
 * whole.
 *
 * The daemon never reports the entire prompt as cached — it held back one token of
 * 4023 on the author's rig — and the MLX engine appears to reuse in blocks, which
 * loses up to a block at the boundary. Neither is a rewrite. The tolerance can afford
 * to be generous because the case it has to catch is not subtle: an edit at position
 * *k* invalidates everything after it, so `cacheRead` collapses to roughly *k*,
 * thousands of tokens short rather than tens.
 */
const CACHE_REUSE_TOLERANCE = 0.02

/** Absolute floor under {@link CACHE_REUSE_TOLERANCE}, for short prompts. */
const CACHE_REUSE_MIN_SLACK = 64

/**
 * Re-exported so this module's own consumers need one import.
 *
 * They live in `@anyapp/core` because the UI renders them. `CacheVerdict` is the
 * sharpest case — `invalidated` is anyapp paying a full re-prefill because something
 * it had already sent changed, and a verdict the user cannot see is the state F1
 * stayed in for six sessions — but the whole record now crosses IPC for the Activity
 * panel, and a shape drawn in the renderer cannot be defined in the main process.
 */
export type {
  CacheVerdict,
  ProviderRequestRecord,
  RequestOutcome,
  TelemetrySnapshot,
  TelemetryTotals
}

/**
 * What one turn cost, for the line the UI shows when it is over.
 *
 * Defined in `@anyapp/core` because it now travels to the renderer on the `complete`
 * chunk. Aliased rather than renamed at every call site: within this module the thing
 * being summarized is a turn's requests, and `TurnSummary` is what that reads as.
 */
export type TurnSummary = TurnCost

/**
 * Records provider requests as they happen.
 *
 * Every method is safe to call out of order or twice. The event sources are Pi's
 * hooks and its session stream, which do not promise a shape on the failure paths —
 * a recorder that threw or double-counted on an aborted run would be worse than no
 * measurement at all.
 */
export interface Telemetry {
  /** A provider request is being sent. Closes any request still open. */
  requestStarted: () => void
  /** Response headers arrived — on Ollama, the prefill is over. */
  responseHeaders: (status: number) => void
  /** The first content delta of the response arrived. */
  firstContent: () => void
  /** An assistant message finished. Closes the open request with what it reports. */
  messageFinished: (result: ProviderResult | null) => void
  /** History is being summarized, which legitimately invalidates the prefix. */
  compactionStarted: () => void
  /** A turn began. Resets what {@link TelemetrySnapshot.turn} covers. */
  turnStarted: () => void
  /** A turn settled. Closes any request still open. */
  turnEnded: () => void
  /** Read the current state. */
  snapshot: () => TelemetrySnapshot
}

/**
 * Parameters for {@link createTelemetry}.
 */
export interface CreateTelemetryParams {
  /** How many requests to keep. Defaults to {@link MAX_RECORDS}. */
  capacity?: number
  /** Clock, injectable so the recorder can be tested without waiting. */
  now?: () => number
}

/**
 * What a finished assistant message says about the request that produced it.
 */
export interface ProviderResult {
  /** The provider's token accounting. */
  usage: ProviderUsage
  /** Why the model stopped, which is the only place a failure is named. */
  stopReason: string
}

/**
 * Read a finished message's provider result.
 *
 * `message_end` IS THE ONLY PLACE A REQUEST FINISHES. Pi's agent loop emits
 * `message_update` for every streaming delta and then leaves the union's `done` and
 * `error` members unemitted — it calls `response.result()` and emits `message_end`
 * with the final message instead (`pi-agent-core/dist/agent-loop.js:222-238`). So a
 * recorder that closed its request on `message_update`/`done` would never close one.
 *
 * `message_end` also fires for user and tool-result messages, and on the failure path
 * it carries an assistant message whose `stopReason` is the only thing distinguishing
 * it from a success — the usage is populated either way. Narrowing rather than
 * asserting is what keeps anyapp's own post-compaction custom message from being
 * recorded as a request, and reading `stopReason` is what keeps a failed request from
 * being recorded as a successful one.
 *
 * @param message - The message Pi finished
 * @returns The result, or null when the message is not a finished assistant message
 */
export function readProviderResult(message: AgentMessage): ProviderResult | null {
  if (typeof message !== 'object' || message === null) return null
  const candidate = message as { role?: unknown; usage?: unknown; stopReason?: unknown }
  if (candidate.role !== 'assistant') return null
  if (typeof candidate.usage !== 'object' || candidate.usage === null) return null
  return {
    usage: candidate.usage as ProviderUsage,
    stopReason: typeof candidate.stopReason === 'string' ? candidate.stopReason : 'stop'
  }
}

/**
 * Decide what the daemon did with the prefix.
 *
 * The question is not how much of *this* prompt was reused — a turn that appends a
 * large tool result legitimately reuses a smaller fraction than one that appends a
 * sentence, and reading the fraction alone would report the healthy case as a
 * degradation. The question is whether everything anyapp had *already sent* came back,
 * so the comparison is against the previous request's prompt.
 *
 * @param params - This request's reuse and the previous request's prompt size
 * @returns The verdict
 */
export function classifyCache(params: {
  /** Prompt tokens the daemon reused, or null when usage did not arrive. */
  cachedTokens: number | null
  /** The previous request's total prompt tokens, or null when there was none. */
  previousPromptTokens: number | null
  /** Whether history was summarized since the previous request. */
  compacted: boolean
}): CacheVerdict {
  const { cachedTokens, previousPromptTokens, compacted } = params
  if (cachedTokens === null) return 'unknown'
  if (previousPromptTokens === null) return cachedTokens > 0 ? 'reused' : 'cold'

  const slack = Math.max(CACHE_REUSE_MIN_SLACK, previousPromptTokens * CACHE_REUSE_TOLERANCE)
  if (cachedTokens >= previousPromptTokens - slack) return 'reused'
  if (compacted) return 'compacted'
  return cachedTokens === 0 ? 'cold' : 'invalidated'
}

/**
 * The middle value of a list, or null when it is empty.
 * @param values - The samples
 * @returns The median
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Create a telemetry recorder.
 *
 * @param params - Capacity and clock
 * @returns The recorder
 */
export function createTelemetry(params: CreateTelemetryParams = {}): Telemetry {
  const { capacity = MAX_RECORDS, now = Date.now } = params

  const records: ProviderRequestRecord[] = []
  const totals: TelemetryTotals = {
    requests: 0,
    prefilledTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    prefillMs: 0,
    invalidations: 0,
    compactions: 0
  }

  /** The request being measured, or null between requests. */
  let open: ProviderRequestRecord | null = null
  /** The previous request's prompt size, which is what a verdict is measured against. */
  let previousPromptTokens: number | null = null
  /** Whether history was summarized since the last request was sent. */
  let compactedSinceRequest = false
  /** Index of the first record belonging to the current turn. */
  let turnFrom = 1
  /** When the current turn started. */
  let turnStartedAt: number | null = null

  /**
   * Close the open request, attributing whatever was measured.
   * @param usage - The provider's accounting, or null when none arrived
   * @param outcome - How it ended
   */
  const close = (usage: ProviderUsage | null, outcome: RequestOutcome): void => {
    if (!open) return
    const record = open
    open = null

    record.outcome = outcome
    record.totalMs = now() - record.startedAt

    if (usage) {
      const prefilled = Math.max(0, usage.input)
      const cached = Math.max(0, usage.cacheRead)
      record.prefilledTokens = prefilled
      record.cachedTokens = cached
      record.promptTokens = prefilled + cached
      record.outputTokens = Math.max(0, usage.output)
      record.reasoningTokens = typeof usage.reasoning === 'number' ? usage.reasoning : null

      totals.prefilledTokens += prefilled
      totals.cachedTokens += cached
      totals.outputTokens += record.outputTokens
      totals.reasoningTokens += record.reasoningTokens ?? 0
    }

    record.cache = classifyCache({
      cachedTokens: record.cachedTokens,
      previousPromptTokens,
      compacted: compactedSinceRequest
    })
    if (record.cache === 'invalidated') totals.invalidations += 1
    if (record.cache === 'compacted') totals.compactions += 1

    // An unmeasured request changes nothing about what the next verdict is measured
    // against, and that covers both of these.
    //
    // The baseline: a compaction request sends its own prompt and says nothing about
    // the conversation's, so zeroing it would make the turn's next request look cold.
    // The excuse: compaction fires its summarization request *after* `compaction_start`,
    // so clearing the flag on that request would spend the explanation on the request
    // that caused it and leave the next one — the one that actually re-prefills the
    // summarized history — reported as the trimmer rewriting history.
    if (record.promptTokens === null) return
    previousPromptTokens = record.promptTokens
    compactedSinceRequest = false
  }

  return {
    requestStarted: (): void => {
      // A request that starts while another is open means the open one produced no
      // message — a compaction summary, or a failure Pi did not surface. Its clock
      // is still real, so it is closed rather than discarded.
      close(null, 'unmeasured')

      totals.requests += 1
      const record: ProviderRequestRecord = {
        index: totals.requests,
        startedAt: now(),
        status: null,
        prefillMs: null,
        firstTokenMs: null,
        totalMs: null,
        promptTokens: null,
        prefilledTokens: null,
        cachedTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cache: 'unknown',
        outcome: 'pending'
      }
      open = record
      records.push(record)
      if (records.length > capacity) records.shift()
      if (turnStartedAt === null) turnStartedAt = record.startedAt
    },

    responseHeaders: (status: number): void => {
      if (!open || open.prefillMs !== null) return
      open.status = status
      open.prefillMs = now() - open.startedAt
      totals.prefillMs += open.prefillMs
    },

    firstContent: (): void => {
      if (!open || open.firstTokenMs !== null) return
      open.firstTokenMs = now() - open.startedAt
    },

    messageFinished: (result: ProviderResult | null): void => {
      if (!result) {
        close(null, 'unmeasured')
        return
      }
      // A failed request still reports usage, so the stop reason is the only thing
      // that separates a turn that worked from one that did not.
      const outcome: RequestOutcome =
        result.stopReason === 'error' ? 'error' : result.stopReason === 'aborted' ? 'aborted' : 'ok'
      close(result.usage, outcome)
    },

    compactionStarted: (): void => {
      compactedSinceRequest = true
    },

    turnStarted: (): void => {
      turnFrom = totals.requests + 1
      turnStartedAt = null
    },

    turnEnded: (): void => {
      close(null, 'unmeasured')
    },

    snapshot: (): TelemetrySnapshot => {
      // `flatMap` rather than `filter` then `map`, because a predicate in `filter`
      // narrows nothing for the `map` that follows it and the arithmetic would have to
      // assert away the nulls it just checked.
      const prefillSamples = records.flatMap(({ prefilledTokens, prefillMs }) => {
        if (prefilledTokens === null || prefillMs === null) return []
        if (prefilledTokens < MIN_RATE_SAMPLE_TOKENS || prefillMs <= 0) return []
        return [prefilledTokens / (prefillMs / 1000)]
      })

      const decodeSamples = records.flatMap(({ outputTokens, totalMs, prefillMs }) => {
        if (outputTokens === null || totalMs === null || prefillMs === null) return []
        if (outputTokens < MIN_DECODE_SAMPLE_TOKENS || totalMs <= prefillMs) return []
        return [outputTokens / ((totalMs - prefillMs) / 1000)]
      })

      const turnRecords = records.filter((record) => record.index >= turnFrom)
      const sum = (pick: (record: ProviderRequestRecord) => number | null): number =>
        turnRecords.reduce((total, record) => total + (pick(record) ?? 0), 0)

      const lastTurnRecord = turnRecords[turnRecords.length - 1]
      const turnEnd = lastTurnRecord
        ? lastTurnRecord.startedAt + (lastTurnRecord.totalMs ?? now() - lastTurnRecord.startedAt)
        : null

      return {
        requests: records.map((record) => ({ ...record })),
        totals: { ...totals },
        turn: {
          requests: turnRecords.length,
          promptTokens: sum((record) => record.promptTokens),
          prefilledTokens: sum((record) => record.prefilledTokens),
          outputTokens: sum((record) => record.outputTokens),
          reasoningTokens: sum((record) => record.reasoningTokens),
          rePrefills: turnRecords.filter(
            (record) => record.cache === 'invalidated' || record.cache === 'compacted'
          ).length,
          elapsedMs:
            turnStartedAt !== null && turnEnd !== null ? Math.max(0, turnEnd - turnStartedAt) : 0
        },
        prefillRate: median(prefillSamples),
        decodeRate: median(decodeSamples)
      }
    }
  }
}

/**
 * Render a turn's cost as one line.
 *
 * Written here rather than in the renderer because it is the log line that makes the
 * measurement usable before there is any UI for it, and W4's status strip should show
 * the user the same sentence the log shows the author.
 *
 * @param turn - The turn's totals
 * @returns A short summary, for example `4 requests · 38.2k prompt · 2 re-prefills · 3m12s`
 */
export function formatTurnSummary(turn: TurnSummary): string {
  const parts = [
    `${turn.requests} ${turn.requests === 1 ? 'request' : 'requests'}`,
    `${formatTokens(turn.promptTokens)} prompt (${formatTokens(turn.prefilledTokens)} prefilled)`,
    `${formatTokens(turn.outputTokens)} out`
  ]
  if (turn.reasoningTokens > 0) parts.push(`${formatTokens(turn.reasoningTokens)} thinking`)
  if (turn.rePrefills > 0) {
    parts.push(`${turn.rePrefills} re-prefill${turn.rePrefills === 1 ? '' : 's'}`)
  }
  parts.push(formatDuration(turn.elapsedMs))
  return parts.join(' · ')
}

/**
 * Render a token count compactly.
 * @param tokens - The count
 * @returns For example `38.2k`
 */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

/**
 * Render a duration compactly.
 * @param ms - The duration
 * @returns For example `3m12s` or `4.2s`
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${Math.round(seconds % 60)}s`
}
