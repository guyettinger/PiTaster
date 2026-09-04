/**
 * Tests for the provider-request recorder.
 *
 * The property worth protecting is the cache verdict, because it is the only number
 * that would have caught Session 25's finding: the trimmer rewriting an already-sent
 * message once per turn, costing a measured ~124s of re-prefill each time. A verdict
 * that reads the reuse *fraction* would have called that healthy — a turn appending a
 * large tool result reuses a smaller share of its prompt than one appending a
 * sentence — so the comparison is against the previous request's prompt, and these
 * tests pin that.
 */

import { describe, expect, test } from 'bun:test'
import {
  classifyCache,
  createTelemetry,
  formatTurnSummary,
  readProviderResult,
  type ProviderResult,
  type ProviderUsage
} from './telemetry'

/**
 * Build usage in Pi's shape.
 *
 * `input` is the prompt the daemon had to prefill and `cacheRead` is what it reused:
 * Pi subtracts the cache hit from `input` when it parses Ollama's
 * `prompt_tokens_details.cached_tokens`, so the two are disjoint and sum to the
 * prompt.
 *
 * @param params - The token counts to report
 * @returns A usage record
 */
function usage(params: {
  /** Prompt tokens prefilled. */
  input: number
  /** Prompt tokens reused. */
  cacheRead?: number
  /** Tokens generated. */
  output?: number
  /** Of those, tokens spent thinking. */
  reasoning?: number
}): ProviderUsage {
  const { input, cacheRead = 0, output = 0, reasoning } = params
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: input + cacheRead + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

/**
 * Wrap usage as the result of a message that stopped normally.
 * @param tokens - The usage to report
 * @returns A provider result
 */
function done(tokens: ProviderUsage): ProviderResult {
  return { usage: tokens, stopReason: 'stop' }
}

/**
 * Build a recorder over a clock the test controls.
 * @returns The recorder and a function to advance its clock
 */
function withClock(): {
  telemetry: ReturnType<typeof createTelemetry>
  advance: (ms: number) => void
} {
  let now = 1_000
  const telemetry = createTelemetry({ now: () => now })
  return {
    telemetry,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('classifyCache', () => {
  test('reports the first request as cold', () => {
    expect(
      classifyCache({ cachedTokens: 0, previousPromptTokens: null, compacted: false })
    ).toBe('cold')
  })

  test('reports a resumed session that hit the daemon cache as reused', () => {
    // A fresh host over a conversation the daemon still holds. There is no previous
    // request to compare against, but reuse is proof the prefix survived.
    expect(
      classifyCache({ cachedTokens: 8_000, previousPromptTokens: null, compacted: false })
    ).toBe('reused')
  })

  test('reports append-only growth as reused', () => {
    expect(
      classifyCache({ cachedTokens: 12_000, previousPromptTokens: 12_000, compacted: false })
    ).toBe('reused')
  })

  test('tolerates the token the daemon holds back and the block boundary', () => {
    // Measured on the author's rig: 4022 of a 4023-token prefix, and 4003 of the same
    // prefix when the request that followed it grew. Neither is a rewrite.
    expect(
      classifyCache({ cachedTokens: 4_003, previousPromptTokens: 4_023, compacted: false })
    ).toBe('reused')
  })

  test('reports a shrunken prefix as invalidated', () => {
    // An edit at position 3000 invalidates everything after it, so the reuse collapses
    // to roughly that position — thousands short, not tens.
    expect(
      classifyCache({ cachedTokens: 3_000, previousPromptTokens: 12_000, compacted: false })
    ).toBe('invalidated')
  })

  test('blames a shrunken prefix on compaction when one happened', () => {
    expect(
      classifyCache({ cachedTokens: 3_000, previousPromptTokens: 12_000, compacted: true })
    ).toBe('compacted')
  })

  test('reports total loss of the prefix as cold, not as a rewrite', () => {
    // The daemon evicted, or reloaded the model. Pi Taster did not rewrite anything, and
    // recording this as an invalidation would credit the trimmer with the daemon's
    // housekeeping.
    expect(
      classifyCache({ cachedTokens: 0, previousPromptTokens: 12_000, compacted: false })
    ).toBe('cold')
  })

  test('says nothing when usage did not arrive', () => {
    expect(
      classifyCache({ cachedTokens: null, previousPromptTokens: 12_000, compacted: false })
    ).toBe('unknown')
  })
})

describe('readProviderResult', () => {
  test('reads usage and the stop reason off an assistant message', () => {
    const found = readProviderResult({
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'ollama',
      model: 'qwen3.8:27b-mlx',
      usage: usage({ input: 10, cacheRead: 5, output: 2 }),
      stopReason: 'stop',
      timestamp: 0
      // The message union is wide and Pi's own shape is what matters here.
    } as never)

    expect(found?.usage.input).toBe(10)
    expect(found?.usage.cacheRead).toBe(5)
    expect(found?.stopReason).toBe('stop')
  })

  test('ignores a message that carries no provider usage', () => {
    // Pi Taster sends a custom message after every compaction. Recording it as a request
    // that generated nothing would drag every average toward zero.
    expect(readProviderResult({ role: 'user', content: 'hello', timestamp: 0 } as never)).toBeNull()
  })
})

describe('createTelemetry', () => {
  test('times the prefill from the request to the response headers', () => {
    // Ollama sends no headers until the first token, which is what makes the gap
    // between the two provider hooks a prefill measurement rather than a guess.
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(133_510)
    telemetry.responseHeaders(200)
    advance(2_000)
    telemetry.firstContent()
    advance(4_000)
    telemetry.messageFinished(done(usage({ input: 11_431, output: 200 })))

    const [record] = telemetry.snapshot().requests
    expect(record.prefillMs).toBe(133_510)
    expect(record.firstTokenMs).toBe(135_510)
    expect(record.totalMs).toBe(139_510)
    expect(record.outcome).toBe('ok')
  })

  test('derives the prefill rate from the prefilled tokens, not the whole prompt', () => {
    // The reused part was never prefilled. Dividing by the whole prompt reports a rate
    // that climbs with the cache instead of a property of the model, and W4 converts
    // that rate back into a time estimate.
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(10_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 1_000, cacheRead: 30_000, output: 50 })))

    expect(telemetry.snapshot().prefillRate).toBe(100)
  })

  test('takes a median rate so one model reload does not set the estimate', () => {
    const { telemetry, advance } = withClock()

    for (const prefillMs of [10_000, 10_000, 120_000]) {
      telemetry.requestStarted()
      advance(prefillMs)
      telemetry.responseHeaders(200)
      telemetry.messageFinished(done(usage({ input: 1_000, output: 10 })))
    }

    expect(telemetry.snapshot().prefillRate).toBe(100)
  })

  test('has no rate until a request is large enough to measure one', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(200)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 12, output: 4 })))

    expect(telemetry.snapshot().prefillRate).toBeNull()
  })

  test('counts an invalidation against the session', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 12_000, output: 100 })))

    // The next request re-sends a history whose middle changed, so the daemon can only
    // reuse up to the edit.
    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 9_500, cacheRead: 3_000, output: 100 })))

    const snapshot = telemetry.snapshot()
    expect(snapshot.totals.invalidations).toBe(1)
    expect(snapshot.requests[1].cache).toBe('invalidated')
  })

  test('does not blame the trimmer for a compaction', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 12_000, output: 100 })))

    telemetry.compactionStarted()
    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 2_000, cacheRead: 500, output: 100 })))

    const snapshot = telemetry.snapshot()
    expect(snapshot.totals.invalidations).toBe(0)
    expect(snapshot.totals.compactions).toBe(1)
  })

  test('does not let the compaction request itself spend the compaction excuse', () => {
    // `compaction_start` fires, and only then does Pi send the summarization request.
    // That request produces both provider hooks and no assistant message, so it closes
    // unmeasured — and if it consumed the explanation, the request after it, which is
    // the one that actually re-prefills the summarized history, would be reported as
    // the trimmer rewriting an already-sent message.
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 30_000, output: 100 })))

    telemetry.compactionStarted()
    telemetry.requestStarted()
    advance(20_000)
    telemetry.responseHeaders(200)

    telemetry.requestStarted()
    advance(4_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 4_000, cacheRead: 200, output: 100 })))

    const snapshot = telemetry.snapshot()
    expect(snapshot.requests[2].cache).toBe('compacted')
    expect(snapshot.totals.invalidations).toBe(0)
  })

  test('clears the compaction excuse after it has been used once', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 12_000, output: 100 })))

    telemetry.compactionStarted()
    telemetry.requestStarted()
    telemetry.messageFinished(done(usage({ input: 2_000, cacheRead: 500, output: 100 })))

    // A second shrunken prefix with no second compaction is the trimmer again.
    telemetry.requestStarted()
    telemetry.messageFinished(done(usage({ input: 2_000, cacheRead: 100, output: 100 })))

    expect(telemetry.snapshot().totals.invalidations).toBe(1)
  })

  test('keeps a compaction request from resetting the next verdict', () => {
    // Compaction issues its own provider request, which produces both provider hooks
    // and no assistant message. Its prompt is not the conversation's, so it must not
    // become the baseline — or the turn's next request reads as cold.
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 12_000, output: 100 })))

    telemetry.requestStarted()
    advance(5_000)
    telemetry.responseHeaders(200)
    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    telemetry.messageFinished(done(usage({ input: 500, cacheRead: 12_000, output: 100 })))

    const snapshot = telemetry.snapshot()
    expect(snapshot.requests[1].outcome).toBe('unmeasured')
    expect(snapshot.requests[1].prefillMs).toBe(5_000)
    expect(snapshot.requests[2].cache).toBe('reused')
  })

  test('reports a turn over the requests it contains', () => {
    const { telemetry, advance } = withClock()

    telemetry.turnStarted()
    telemetry.requestStarted()
    advance(2_000)
    telemetry.responseHeaders(200)
    advance(1_000)
    telemetry.messageFinished(done(usage({ input: 10_000, output: 100, reasoning: 60 })))
    telemetry.requestStarted()
    advance(1_000)
    telemetry.responseHeaders(200)
    advance(1_000)
    telemetry.messageFinished(done(usage({ input: 400, cacheRead: 10_100, output: 50, reasoning: 20 })))
    telemetry.turnEnded()

    const { turn } = telemetry.snapshot()
    expect(turn.requests).toBe(2)
    expect(turn.promptTokens).toBe(20_500)
    expect(turn.prefilledTokens).toBe(10_400)
    expect(turn.outputTokens).toBe(150)
    expect(turn.reasoningTokens).toBe(80)
    expect(turn.rePrefills).toBe(0)
    expect(turn.elapsedMs).toBe(5_000)
  })

  test('a new turn covers only its own requests', () => {
    const { telemetry, advance } = withClock()

    telemetry.turnStarted()
    telemetry.requestStarted()
    advance(1_000)
    telemetry.messageFinished(done(usage({ input: 10_000, output: 100 })))
    telemetry.turnEnded()

    telemetry.turnStarted()
    telemetry.requestStarted()
    advance(1_000)
    telemetry.messageFinished(done(usage({ input: 200, cacheRead: 10_100, output: 20 })))
    telemetry.turnEnded()

    const { turn, totals } = telemetry.snapshot()
    expect(turn.requests).toBe(1)
    expect(turn.promptTokens).toBe(10_300)
    expect(totals.requests).toBe(2)
  })

  test('drops the oldest request past capacity while the totals keep counting', () => {
    let now = 1_000
    const telemetry = createTelemetry({ capacity: 3, now: () => now })

    for (let i = 0; i < 6; i += 1) {
      telemetry.requestStarted()
      now += 1_000
      telemetry.responseHeaders(200)
      telemetry.messageFinished(done(usage({ input: 5_000, output: 50 })))
    }

    const snapshot = telemetry.snapshot()
    expect(snapshot.requests.length).toBe(3)
    expect(snapshot.requests[0].index).toBe(4)
    expect(snapshot.totals.requests).toBe(6)
    expect(snapshot.totals.prefilledTokens).toBe(30_000)
  })

  test('records a failed request as failed, though it reports usage like any other', () => {
    // Pi's failure path emits `message_end` carrying an assistant message with a
    // populated `usage`, so the stop reason is the only thing that distinguishes it.
    // Reading the usage alone would report every failed turn as a successful one.
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.messageFinished({ usage: usage({ input: 8_000 }), stopReason: 'error' })

    const [record] = telemetry.snapshot().requests
    expect(record.outcome).toBe('error')
    expect(record.prefilledTokens).toBe(8_000)
  })

  test('separates a run the user stopped from one that failed', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.messageFinished({ usage: usage({ input: 8_000 }), stopReason: 'aborted' })

    expect(telemetry.snapshot().requests[0].outcome).toBe('aborted')
  })

  test('claims no tokens for a request that ended with nothing to report', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    advance(1_000)
    telemetry.messageFinished(null)

    const [record] = telemetry.snapshot().requests
    expect(record.outcome).toBe('unmeasured')
    expect(record.promptTokens).toBeNull()
    expect(record.cache).toBe('unknown')
    expect(record.totalMs).toBe(1_000)
  })

  test('ignores events that arrive with no request open', () => {
    const { telemetry } = withClock()

    telemetry.responseHeaders(200)
    telemetry.firstContent()
    telemetry.messageFinished(done(usage({ input: 100, output: 10 })))

    expect(telemetry.snapshot().requests).toEqual([])
  })

  test('hands out copies, not the records it keeps writing to', () => {
    const { telemetry, advance } = withClock()

    telemetry.requestStarted()
    const before = telemetry.snapshot().requests[0]
    advance(1_000)
    telemetry.responseHeaders(200)

    expect(before.prefillMs).toBeNull()
    expect(telemetry.snapshot().requests[0].prefillMs).toBe(1_000)
  })
})

describe('formatTurnSummary', () => {
  test('names the re-prefills, which are the point of the line', () => {
    const line = formatTurnSummary({
      requests: 4,
      promptTokens: 38_200,
      prefilledTokens: 12_400,
      outputTokens: 1_100,
      reasoningTokens: 380,
      rePrefills: 2,
      elapsedMs: 192_000
    })

    expect(line).toBe(
      '4 requests · 38.2k prompt (12.4k prefilled) · 1.1k out · 380 thinking · 2 re-prefills · 3m12s'
    )
  })

  test('stays quiet about what did not happen', () => {
    const line = formatTurnSummary({
      requests: 1,
      promptTokens: 900,
      prefilledTokens: 900,
      outputTokens: 40,
      reasoningTokens: 0,
      rePrefills: 0,
      elapsedMs: 4_200
    })

    expect(line).toBe('1 request · 900 prompt (900 prefilled) · 40 out · 4.2s')
  })
})
