# Session 25 Notes: Auditing the Ollama interaction

**Date**: 2026-09-03
**Status**: ✅ Complete
**Duration**: ~5 hours

## What Was Built

Sessions 19–24 built the machinery for running a real agent on a local model —
a discovered context window, scaled compaction, a trimmer, an edit-repair hook, a
context meter — and none of it had ever been measured against the daemon it
manages. Session 25 measured it and fixed what the measurement found.

The headline: **anyapp was destroying Ollama's KV prefix cache on essentially
every turn, at a cost of about 124 seconds each time, and had been since the
trimmer was written.** The module that exists to *save* context was spending the
most expensive resource in the system. Nothing in the app produced a number that
would have shown it.

All six workstreams landed. Measured against the daemon's own cache accounting,
turn boundaries that previously cost a full re-prefill now cost 25–27 tokens.

### Components Created

1. **`apps/electron/src/main/agent/telemetry.ts`** — a ring buffer of the last 64
   provider requests
   - Prompt / prefilled / reused / output tokens, prefill and decode timings, and
     a **measured** cache verdict per request
   - Median prefill and decode rates, over `prefilledTokens` rather than the whole
     prompt — the reused part was never prefilled, and dividing by it would report
     a rate that rises with the cache rather than a property of the model
   - Lifetime totals that outlive the buffer, because the two numbers that settle
     whether W1 worked are the ones a long session forgets first
   - `formatTurnSummary` for the console line, before the UI had a home for it

2. **`apps/electron/src/main/agent/sampling.ts`** — per-model sampling resolution
   - Three states per setting: a pinned number, `null` for "send nothing",
     `'auto'` for anyapp's recommendation
   - `RECOMMENDED_SAMPLING` lives in `@anyapp/core` so the request and the Settings
     hint read the same constant

3. **`apps/electron/src/renderer/src/components/ThinkingBubble.tsx`** — the model's
   reasoning, streaming live and folding to a one-line estimate

4. **`apps/electron/src/renderer/src/components/TurnSummaryStrip.tsx`** — what the
   finished turn cost, and what the daemon did with the prefix

5. **`apps/electron/src/renderer/src/components/DaemonHealthStrip.tsx`** and
   **`hooks/useDaemonHealth.ts`** — reachability and the model-unload clock, rendering
   nothing when nothing is wrong

6. **Test files** for `telemetry`, `sampling`, `events` and `ollama` — the last three
   had none.

### Changed

- **`agent/context-trim.ts`** — rewritten around `createContextSealer`. Trims apply at
  a *seal* that advances when `sealAdvanceTokens` of new history accumulates, and are
  written into Pi's own messages so its compaction check sees them.
- **`agent/context-budget.ts`** — `sealAdvanceTokens`, bounded above by what compaction
  keeps.
- **`agent/events.ts`** — carries `thinking_delta` instead of dropping it.
- **`agent/ollama.ts`** — `readDaemonHealth`, `supportsReasoningEffort: true`, a
  concurrency cap on `describeModel`, a read-merge in `writeOllamaModelsFile`, and one
  `/api/ps` per session start instead of two.
- **`agent/session.ts`** — telemetry hooks, the sealer wiring, `thinkingLevel` from
  config, sampling from the model.
- **`agent/diagnostics-note.ts`** — a wall-clock budget on the dependent scan.
- **`main/ipc.ts`** — session-scoped telemetry, `daemon:health`, URL parsing, sampling
  and reasoning validation, and **`config:save` finally disposes the host**.
- **`packages/core/src/agent.ts`** — `CacheVerdict`, `TurnCost`, `DaemonHealth`,
  `RECOMMENDED_SAMPLING`, `ContextReport.prefillRate`; `rate_limit` and `contextUsage`
  removed.

## Decisions

**Measure the cache, do not infer it.** The plan specified a verdict derived from an
implied prefill rate against a learned cold rate. Measuring the daemon showed that is
unnecessary: Ollama reports `prompt_tokens_details.cached_tokens` and Pi already maps
it to `Usage.cacheRead`. The verdict became a direct reading, and the cold prefill rate
fell out as a by-product.

**The verdict compares against the previous request's prompt, not this one's fraction.**
A turn appending a large tool result legitimately reuses a smaller share than one
appending a sentence, so a fraction would report the healthy case as a degradation.

**The seal stops at the current turn**, not at the screenshot cutoff the design first
used. Gating on the image rule would have let three turns of untrimmed history ride in
every request; this bounds the tail to one turn plus the threshold.

**Superseding is deferred, deliberately.** It is the one rule that can never be settled
— any later read might cover an earlier one — so taking the saving as soon as it appears
is exactly the per-turn prefix rewrite the seal exists to stop.

**Four reasoning levels, not Pi's seven.** The audit measured `medium` coming back
byte-identical to sending nothing and everything above `high` collapsing into it.
Offering levels the daemon cannot distinguish is a control that does nothing, which is
the defect the workstream was about.

**The old pinned `0` temperature is flagged, not migrated.** anyapp wrote it into
`config.json` as a default, so on disk it is indistinguishable from a `0` someone chose.
Settings says *Recommended for this model: 0.6* beside it instead.

**Nothing reassuring renders when there is nothing to say.** The daemon health strip is
empty when the daemon is fine, and the prefill-time line is absent until there is a
measured rate. A strip that is always present stops being read; a rate computed from a
constant is the same mistake as trusting the advertised context window.

## Deviations from Plan

**W1's mechanism changed, because the plan's was impossible.** The plan's "key move" was
to write the seal back from `transformContext`. Pi hands that hook
`structuredClone(messages)` (`extensions/runner.js:793`), so a write there reaches a copy.
The session's live list is passed to the hook instead — through a function, never a
captured array. The plan's named fallback (memoise the frozen range, leave F2 unfixed)
was not needed.

**W6's `config:save` disposal landed in W3.** The reasoning-effort control depended on it:
without it the new setting would have done nothing until an unrelated action rebuilt the
session, which is worse than not shipping it.

**W5 gained a rule the plan did not anticipate.** `'auto'` `top_p` sends nothing whenever
the temperature in effect is 0. Without it, an install carrying anyapp's old pinned 0
would have started sending a nucleus cutoff modifying a greedy temperature the moment the
field appeared.

**W6 left `auto-commit.ts` alone, deliberately.** The observation is correct — a full
isomorphic-git commit runs synchronously in the `tool_result` hook — but the commit is
what makes a write roll-back-able, and `rollback` is a `git checkout`, which restores
tracked files and leaves untracked ones in place. A write whose commit is still in flight
when a rollback runs would survive it. The hook also appends the commit's failure note to
the tool result, which requires the result.

## Left Undone

- **The seal's batched invalidation was never observed live.** Every conversation driven
  in this session peaked around 9.6k tokens against a 16384 threshold, so the seal never
  advanced. What was measured is the elimination of the *per-turn* rewrite, which is the
  dominant cost; the advance itself is covered by tests only. A long working session
  would exercise it, and W2's `N invalidated` counter is where it would show.
- **W4 items 3 and 4** — `status.kind` colouring and clearing status on `error` — are
  code-verified only. The status strip renders during compaction, a retry, or a long
  prefill, none of which a short healthy turn produces on demand.
- **W2's `[agent]` console line was never seen through the harness.** The `run-app`
  driver does not forward main-process stdout. The daemon's own log was used instead,
  and is the better instrument anyway.

## Gotchas

**Pi's `context` hook receives a deep clone.** `emitContext` does
`structuredClone(messages)` before calling any handler, so nothing written there reaches
Pi's state, its compaction estimate, or the request. This is the single fact that
reshaped W1, and nothing in Pi's docs says it.

**But Pi's messages *are* mutable, and it mutates them itself.** `_replaceMessageInPlace`
(`agent-session.js:453-460`) carries a comment endorsing the practice. Session entries
hold the *same* message objects and `sessionEntryToContextMessages` hands them straight
back, so a mutation survives the rebuild that compaction and branching do. Verified by
probe: `estimateContextTokens` dropped from 10001 to 106 across an in-place edit.

**`agent.state.messages` is replaced wholesale after a compaction** (`agent-session.js:1536`).
A held array reference goes stale exactly when the history changes most — read it through
a function.

**The JSONL transcript is written when a message is appended**, and `SessionManager`
buffers everything until the first assistant message, then rewrites the lot. Mutating a
message before its entry is on disk would put trimmed text into the transcript. The seal
never reaching into the current turn is what keeps that from happening.

**Ollama's server log reports the prefix cache directly.**
`~/.ollama/logs/server.log` carries `msg="cache hit" total=7292 matched=7265` per
request. It is a better instrument than anyapp's own telemetry for verifying W1, because
it is the daemon's accounting rather than anyapp's.

**Ollama emits no `completion_tokens_details`**, so Pi's `Usage.reasoning` is `0` on every
response — while `message.reasoning` is populated. A zero there means "not reported",
never "no thinking happened", and reading it the other way is the same mistake as
believing the off switch.

**There is no off switch for thinking on the `/v1` path.** `thinkingLevel: 'off'` makes
Pi send no `reasoning_effort`, and the models reason anyway. Ollama's native
`think: false` works but is `/api/chat`, which Pi does not use.

**`message_update` never carries `done` or `error` from `AssistantMessageEvent`.** Pi's
loop calls `response.result()` and emits `message_end` instead (`agent-loop.js:205-238`),
so a request is finalized there. A failed request still reports usage; only `stopReason`
separates it.

**`agent_start` re-fires per retry and per continuation**, so it is not a turn anchor.
`agent_settled` fires from a `finally` in `_runAgentPrompt`, which makes it the honest end.

**MLX prefill runs on the GPU.** The `ollama runner` process sits near 1% CPU while
working. Two healthy runs were killed during this session on the belief that the daemon
was idle; `~/.ollama/logs/server.log` is what proves otherwise.

**Backgrounding with `&` inside a tool call does not survive the call.** The `run-app`
skill documents this and it was still hit. Use the harness's own background mode.

**`config:save` never disposed the agent host**, so every setting on that page —
temperature, tool profile, trim — took effect only when an unrelated action happened to
rebuild the session. Six sessions of settings had this property.
