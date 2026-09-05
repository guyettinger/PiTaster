# Session 19: Local Model Context Budget

**Goal**: Make the agent survive a long session on a slow, small-context local
model — by telling Pi the truth about the context window, scaling its compaction
to fit, showing the user what recovery looks like, and shaping what actually
reaches the model.

## Why

Key Lime Pi targets a local Ollama daemon. On the reference configuration —
`qwen3.8:27b-mlx`, a 27B MLX model — three things were broken, and none of them
were tuning:

**1. Pi was told the wrong context window.** `agent/ollama.ts` read
`<arch>.context_length` from `/api/show`, which is the model's *architectural
maximum*, not what the daemon serves:

```
qwen3.8:27b-mlx   /api/show → qwen3_5.context_length = 262144
                  /api/ps   → context_length         =  65536
```

Pi's `shouldCompact` is `tokens > contextWindow - reserveTokens`. Told 262144, it
never fires. Ollama silently truncates at 65k instead — no error, no event — so
the model loses its system prompt and tool schemas mid-run and starts flailing.

`num_ctx` cannot be set over the OpenAI-compatible `/v1` endpoint. The effective
window has to be *discovered*, not configured.

**2. Pi's compaction defaults assume a frontier window.**
`DEFAULT_COMPACTION_SETTINGS` is `reserveTokens: 16384`, `keepRecentTokens:
20000` — 36k of reserved budget — and Key Lime Pi never set `settings.compaction`.
Point the window at a realistic 32k and compaction becomes `tokens > 16384` with
a retained tail that alone overflows what is left: compact, then immediately
compact again.

**3. Every recovery signal Pi emits was dropped.** `agent/events.ts` returned
`null` for anything it did not recognise, which was `compaction_start`,
`compaction_end`, `auto_retry_start`, `auto_retry_end`, `summarization_retry_*`,
`agent_settled` and `queue_update`. Pi was already auto-retrying and
auto-compacting; the UI rendered a silent hang while it did.

## Decisions

| Question | Decision |
|---|---|
| Context window source | Probe `/api/ps` after warming; user override in Settings; conservative 32k fallback |
| Compaction settings | Derived from the budget, never Pi's defaults |
| Retry | Pi's policy only — provider-level retries disabled so retries stay visible |
| HTTP idle timeout | 600s; a long prefill is a legitimate silent gap |
| Context shaping | `context` extension hook, non-destructive — the transcript keeps everything |
| Tool surface | Profile-based; `lean` only ever *removes* names from the allowlist |
| Loop detection | Soft block via `ToolCallEventResult`, so the model is told, not crashed |
| Approval timeout | Removed. A silent denial is worse than an open prompt |

## Scope

1. **`agent/context-budget.ts`** — one derived `ContextBudget` driving
   `models.json` (`contextWindow`, `maxTokens`) and Pi's `compaction` settings.
2. **Ollama probing** — `warmModel` and `getLoadedContextLength` in
   `agent/ollama.ts`, both failing soft.
3. **`settingsManager.applyOverrides`** in `createAgentHost` for compaction,
   retry, and `httpIdleTimeoutMs`. Key Lime Pi never writes Pi's `settings.json`.
4. **`StreamChunk.status`** — compacting / retrying / waiting / settled, plus a
   stall heartbeat and a context meter.
5. **`agent/context-trim.ts`** — caps tool results, collapses superseded reads,
   drops stale screenshots. Shapes what is *sent*, not what is stored.
6. **Tool profiles and a system-prompt diet** — the `## Available Tools` section
   duplicated the function-calling schema and is deleted.
7. **`agent/loop-guard.ts`** — soft-blocks the third consecutive identical call.
8. **`working-notes` runtime skill** — a `NOTES.md` convention so a plan survives
   compaction, plus a post-compaction nudge.

## Not in scope

- Crash-resume of an in-flight run. Pi's transcript already survives; restoring
  mid-turn state does not, and is not worth the complexity.
- Any change to path confinement, permission modes, or tool classification.
  `lean` removes tools; it never widens what a tool may do.
- Setting `num_ctx`. It is not reachable over `/v1`; the daemon owns it.
