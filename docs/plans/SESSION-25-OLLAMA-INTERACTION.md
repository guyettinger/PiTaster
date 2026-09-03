# Session 25: The interaction with the daemon

**Status**: In progress — W2 landed; measurements in [SESSION-25-AUDIT.md](SESSION-25-AUDIT.md)

## Goal

Make anyapp's use of the Ollama daemon fast, honest and legible.

Sessions 19–24 built the machinery for fitting an agent into a small local
window — a discovered window, scaled compaction, a trimmer, an edit-repair hook,
a context meter. It was all built from reasoning about the daemon rather than
measurement of it, and the measurement (see the audit) says two of those pieces
are working against the machine:

- The trimmer, written to *save* context, is spending **~124 s of re-prefill per
  turn** destroying a KV prefix cache worth ~500x.
- The agent has been emitting reasoning tokens on every request since Session 15,
  while `session.ts:637` says `thinkingLevel: 'off'` and the UI shows nothing.

And nothing in `apps/electron/src/main/agent/` measures latency, throughput,
token counts or request counts, so neither was visible.

## The finding that reorders everything

On the rig in the audit — `qwen3.8:27b-mlx`, MLX engine, served window 65 536 —
prefill runs at **85.6 tok/s**. Filling the window costs ~12.8 minutes. Resending
a byte-identical prompt costs **0.24 s**, because the daemon reuses its KV cache.
Changing one message *early* in the list costs **124 s**, a full re-prefill.

So the prompt prefix is not just a token budget, it is a **wall clock**, and the
single most valuable property anyapp can give it is *stability*.

`tool-guidance.ts:92-95` already states the principle, for the tool guidance
ordering: *"a prompt that reorders between requests defeats prefix caching for no
benefit."* The trimmer violates it three times over.

## Findings

| | Finding |
|---|---|
| **F1** | `context-trim.ts` invalidates the prefix cache at every turn boundary |
| **F2** | Compaction fires on the *untrimmed* size, so trimming can never relieve it |
| **F3** | Thinking is on for every request; anyapp believes it is off |
| **F4** | Nothing in the agent directory is instrumented |
| **F5** | The interaction is largely invisible in the UI |
| **F6** | Sampling defaults to greedy, which the model is documented to dislike |
| **F7** | Session-rebuild thrash, and `config:save` not taking effect |

### F1 — the trimmer is stable within a request, not across turns

`trimContext` is idempotent for a *given* message list, which is what
`context-trim.test.ts` asserts. It is not stable as a session advances. Three
rules rewrite messages that have already been sent:

- **the current-turn exemption expires.** `inCurrentTurn` (`context-trim.ts:483`)
  exempts the current turn from `maxToolResultTokens` (`:523`). One turn later the
  same result is no longer current, so a tool result that was sent in full is sent
  truncated — a different byte sequence in the middle of the prefix.
- **superseding rewrites backwards.** `:507-514` replaces an earlier read with a
  pointer as soon as a later read covers its region.
- **screenshots vanish at turn three.** `imageCutoff` (`:478`, `:487`).

Each is correct as a token-budget decision and each is a cache invalidation. The
audit's row 4 prices one at ~124 s.

Note what is *not* wrong: superseding compares **regions, not paths**
(`covers`, `:237-239`), and truncation recomputes Pi's resume footer rather than
cutting it (`truncateResult`, `:366-398`). Both are rules from
`.claude/rules/self-modification.md` that have been broken before, both are right
now, and both must survive the redesign unchanged.

### F2 — compaction cannot see the trimming

Recorded already in `AGENTS.md`: Pi decides to compact from
`estimateContextTokens(agent.state.messages)`, while the trimmer runs as
`transformContext`, which builds one request and never writes back. Compaction
therefore fires on a number at or above what is actually sent, and on a session
full of large tool results the agent summarises away history that would have fit.

F1 and F2 have a common cause — the trim is a *view*, recomputed per request,
rather than a *decision* — and therefore a common fix.

### F3 — thinking

`session.ts:637` passes `thinkingLevel: 'off'`. `ollama.ts:400` sets
`supportsReasoningEffort: false`, which strips the parameter that carries it. Every
`/v1` response in the audit came back with a populated `reasoning` field, on all
eight variants tried. The reasoning spends the `maxTokens` budget (8192 on this
rig) before any answer is produced, and `events.ts:203-204` drops `thinking_delta`,
so the user watches the pulsing ellipsis from `TextBubble.tsx:41-43` throughout.

`reasoning_effort` is honoured by the daemon but weakly — `medium` is identical to
absent, `low` and `high` are distinct. It is a real control that a compat flag is
currently disabling.

### F4 — no instrumentation

There is no logging anywhere under `apps/electron/src/main/agent/`. Nothing
records request latency, time-to-first-token, prefill/decode split, tokens per
second, provider requests per turn, or the daemon's own prompt-token counts. The
only wall clocks are `stall-notifier.ts`, which formats elapsed seconds into a
user-facing string and discards the number, and `retry-budget.ts`.

This is why F1 survived three sessions of work on the context window.

### F5 — what the UI does not say

`AgentStatusStrip` (`Chat.tsx:182`) never reads `status.kind`, so compaction, an
ECONNREFUSED retry and a 20-second prefill render as the same brass dot. Status is
not cleared on `error`, so "…retrying" can outlive the run. Daemon health is
checked only in Settings, once, and `reachable` initialises to `true`
(`Settings.tsx:163`) so the wrong state flashes on mount. `contextUsage` on the
`complete` chunk and the entire `rate_limit` variant have no consumer.

### F6 — sampling

`DEFAULT_SAMPLING_TEMPERATURE = 0` (`session.ts:308`), and `temperature` is the
only parameter set anywhere on the agent path (`createSamplingExtension`,
`session.ts:338-348`). Qwen3 thinking models are documented to degrade and loop
under greedy decoding — and `loop-guard.ts` exists to catch precisely that
symptom, which makes it worth asking whether the guard is treating a cause we
introduced.

### F7 — rebuild thrash

Fourteen sites call `disposeAgentHost`, each making the next prompt pay
`warmModel` + two `/api/ps` probes + a full `models.json` rewrite +
`ModelRuntime.create` + `loader.reload()` + a fresh TypeScript program build.
`config:save` is not one of them, so a temperature, tool-profile or trim change
silently does not take effect until something unrelated disposes the host.

## Approach

### W1 — Sealed prefix: make the sent prompt append-only — **landed**

The invariant: **once a byte has been sent to the daemon it does not change until
a deliberate, rare reset.**

A *seal* replaces the per-request transform. `createContextSealer` in
`agent/context-trim.ts` holds one per session and exposes two operations:

- `seal(messages)` freezes everything before the current turn — truncation,
  superseding and screenshot-stripping, applied once and permanently.
- `capForRequest(messages)` applies `hardToolResultTokens` and nothing else. That
  cap asks *can this request succeed at all*, not *is this worth its space*, so it
  must keep applying immediately and must not be written back.

The seal advances only when `sealAdvanceTokens` of new history has accumulated —
a quarter of the window, bounded above by what compaction keeps, since history
about to be summarized away is not worth a cache invalidation to seal. A session
pays one invalidation at a moment anyapp chose, several turns apart, instead of one
per turn at a moment it did not.

The seal stops at the current turn rather than at a screenshot cutoff, which is
what bounds the untrimmed tail to one turn plus the threshold. Superseding is the
one rule that can never be settled — any later read might cover an earlier one — so
that saving is deliberately deferred to the next advance rather than taken the
moment it appears.

**The blocking question, settled.** Pi tolerates mutation of its stored messages,
and does it itself (`agent-session.js:453-460`). Verified against 0.84.4: session
entries hold the *same* message objects and `sessionEntryToContextMessages` returns
them unchanged, so a mutation survives the rebuild that compaction and branching do;
`estimateContextTokens` reads content live, measured dropping from 10001 to 106
tokens across an in-place edit — which is F2 fixed; and anyapp's chat UI reads the
transcript from disk, so the conversation a person sees keeps everything.

**But the `context` hook cannot be where it happens.** Pi hands that hook
`structuredClone(messages)` (`extensions/runner.js:793`), so the plan's stated
mechanism — write back from `transformContext` — reaches a copy and is discarded
with it. `session.ts` passes the hook the live list through a function instead,
never a captured array, because Pi replaces `state.messages` wholesale after a
compaction (`agent-session.js:1536`). The fallback this plan named — memoise the
frozen range and leave F2 unfixed — was therefore not needed.

Tested, including the property that was untrue and untested before:
**the same conversation at turn N and turn N+1 sends byte-identical bytes for every
message the seal has not reached**, the seal advancing only on the threshold, the
write-back landing in the caller's own messages, `capForRequest` leaving them alone,
and the baseline re-anchoring when compaction shrinks the history it was measuring.

### W2 — Instrument the request path — *do this first* — **landed**

`agent/telemetry.ts`: a ring buffer of the last N provider requests, each holding
prompt tokens, completion tokens, wall time, time-to-first-token and a **cache
verdict**, plus lifetime counts the buffer cannot forget.

**The verdict is measured, not inferred.** The audit's §2 found that Ollama reports
`prompt_tokens_details.cached_tokens` and that Pi already maps it to `Usage.cacheRead`
while subtracting it from `Usage.input` — so `input` is exactly what the daemon had to
prefill and `cacheRead` is exactly what it reused. No cold-rate comparison is needed
to tell a reused prefix from a re-prefilled one.

What the verdict asks is not how much of *this* prompt was reused — a turn appending a
large tool result legitimately reuses a smaller share than one appending a sentence, and
reading the fraction would report the healthy case as a degradation. It asks whether
everything already sent came back, so `cacheRead` is compared against the *previous*
request's prompt: `reused`, `invalidated` (the F1 signal), `compacted` (the legitimate
one), `cold`, `unknown`.

Timing comes from `before_provider_request` and `after_provider_response`, which bracket
the prefill because Ollama withholds response headers until the first token. A request is
closed on `message_end` — Pi's `done` and `error` events never reach `message_update`
(`pi-agent-core/dist/agent-loop.js:222-238`), so a recorder that waited for them would
never close one, and a failed request reports usage like any other, so the stop reason is
what separates the two.

The **cold prefill rate** falls out of the same data — `input / prefillMs`, medianed so a
model reload does not set the estimate — and is what converts a token count into a time
estimate for W4.

`ipc.ts` owns the recorder rather than the host, because `disposeAgentHost` runs on every
skills, sources or config save and the count has to span the conversation, not the host.
Until W4 gives it a home in the UI, each settled turn logs one `[agent]` line.

This was sequenced ahead of W1 deliberately. W1's benefit is a claim until it is
measured on real sessions, F6 cannot be settled without evidence, and the
re-prefill count per session — the number that would have made F1 obvious — did
not exist before this.

### W3 — Thinking: surface it, then expose the control — **landed**

- Carry `thinking_delta` as a new `StreamChunk` variant instead of dropping it
  (`events.ts:203-204`), mirrored in all three type files per the comment at
  `packages/core/src/agent.ts:69-76`.
- Render it as a collapsed, live-streaming *Thinking* region in the transcript.
  This is the largest legibility win available: it fills the silence that the stall
  notifier currently papers over at 20 s with a generic apology.
- Flip `supportsReasoningEffort` (`ollama.ts:400`) and add a reasoning-level
  setting beside temperature, shown only when the model advertises the `thinking`
  capability — which `describeModel` already collects as `supportsThinking` and
  currently uses only to set `reasoning: true` in `models.json`.

Four levels are offered, not Pi's seven: the audit measured `medium` coming back
byte-identical to sending nothing, and the levels above `high` collapsing into it,
so the rest would be a control that does nothing. The `off` value is called **Unset**
because it is not off — Pi sends no `reasoning_effort` for it and the models reason
anyway. Turning thinking off would need Ollama's native `think: false` on
`/api/chat`, which is not the path Pi uses.

**One item was pulled forward from W6.** `config:save` did not dispose the agent
host, so every setting on that page — the new one, the temperature, the tool
profile — took effect only when some unrelated action happened to rebuild the
session. Shipping a control that silently does nothing is worse than not shipping
it, so the dispose landed here. It is deliberately *not* paired with
`forgetCachedReport` or `forgetSessionTelemetry`: the conversation it disposes is
still the one on screen.

Verified on the running app: the reasoning streams into a collapsed *Thinking*
region during the turn, expands to the model's actual text, and the effort control
appears only for a model advertising `thinking`, saves, and persists.

### W4 — Say what the interaction is doing

1. **The context meter shows time, not only tokens.** The window has a wall clock:
   `31k / 65k · ~6 min to prefill if the cache misses`. `ContextMeter.tsx` and
   `ContextBreakdown.tsx` already carry the window, the compaction tick and the
   provenance sentence; this is one derived line, and it is the number that
   predicts how long the next turn takes.
2. **A cache indicator with a reason** — reused, or re-prefilled because *history
   was rewritten* / *summarised* / *model reloaded*. This makes W1's benefit
   visible and would have surfaced F1 immediately.
3. **Use `status.kind`** for icon and colour in `AgentStatusStrip`.
4. **Clear status on `error`.**
5. **A turn summary**: `4 requests · 38k prompt tokens · 2 cache misses · 3m12s`,
   from W2's buffer.
6. **Persistent daemon health** outside Settings; fix `reachable` initialising to
   `true`.
7. **Model-unload warning.** `/api/ps` reports `expires_at`. A model loaded outside
   anyapp carries the daemon's 5-minute default rather than the warm call's 30
   minutes, and the turn after an unload pays a full reload of a 32 GB model.

### W5 — Model-aware sampling defaults

Default thinking models to their documented sampling (temperature ~0.6, `top_p`
~0.95) rather than greedy, keeping `0` available. Extend `createSamplingExtension`
to carry `top_p`, add the field beside temperature in `Settings.tsx:417-445`, and
validate it in `config:save` alongside the existing bounds check.

Do **not** plumb `top_k`, `min_p` or `repeat_penalty`: they are Ollama-native
`options`, absent from the `/v1` schema. The audit shows they are accepted without
error and there is no evidence they are honoured.

Land this after W2 so the change can be judged on measured repetition and
tool-call validity rather than on the release notes.

### W6 — Stability cleanups

Independent of the above, listed so they are not rediscovered:

- `config:save` should dispose the host (F7).
- `/api/ps` is probed twice per session start — `ollama.ts:466` and again inside
  `syncOllamaModels`.
- `describeModel` fans out one concurrent `/api/show` per pulled model on every
  Settings open, with no concurrency cap.
- `writeOllamaModelsFile` clobbers the file with no read-merge.
- `ollamaBaseUrl` is validated only as a string ≤ 2048 chars, with no URL parse.
- `ollama.ts` has no test file, though every other module in `agent/` with logic
  has one.
- `diagnostics-note.ts` issues one sequential, untimed TypeScript request per
  referencing file, inside the `tool_result` hook.
- `auto-commit.ts` runs a full isomorphic-git commit synchronously in that same
  hook, once per write.
- `rate_limit` has no producer; `contextUsage` on `complete` has no consumer.

## Sequencing

**W2 → W1 → W3 → W4 → W5 → W6.** W2 first because everything after it is otherwise
unfalsifiable. W6 is independent and can be taken in any gap.

## Scope

- `agent/telemetry.ts` — new; the request-level ring buffer and cache verdict.
- `agent/context-trim.ts` — the sealed-prefix redesign.
- `agent/context-budget.ts` — a seal threshold beside the existing shares.
- `agent/session.ts` — hook registration, telemetry wiring, `top_p`.
- `agent/events.ts` — `thinking_delta` becomes a chunk.
- `agent/ollama.ts` — `supportsReasoningEffort`, and the W6 cleanups.
- `packages/core/src/agent.ts` and its two mirrors — the new chunk variant.
- `ContextMeter.tsx`, `ContextBreakdown.tsx`, `Chat.tsx`, `Settings.tsx`.

## Out of scope

- Turning thinking **off** on the agent path. It needs Ollama's native
  `/api/chat` `think` parameter, which is not the endpoint Pi uses; leaving `/v1`
  is a larger architectural change than this session should carry, and the
  measurements do not yet say it would help.
- Characterising the MLX engine's partial-reuse behaviour beyond what W2 needs.
  Audit row 3 is unexplained — append-only growth cost more than the cold rate
  predicts — and it bounds what W1 can recover, but it is the daemon's behaviour
  to explain, not anyapp's to fix.
- A host allowlist for `web_fetch`. Still the right idea, still unrelated to this.

## Verification

- `bun run typecheck:all` after every workstream.
- `context-trim.test.ts` gains cross-turn byte-stability tests; the existing
  region-superseding and resume-footer cases must keep passing unchanged.
- Re-run both audit scripts on the same rig and compare row 4 against row 2. If W1
  works, a turn boundary stops producing a full re-prefill and the count of
  re-prefills per session falls to roughly the number of compactions.
- W2's own output is the acceptance test for W1: re-prefills per session, before
  and after, on a real session rather than a synthetic one.
- Drive the app with the `run-app` skill to confirm the thinking region streams,
  the meter shows a time estimate, and the status strip distinguishes its kinds.
