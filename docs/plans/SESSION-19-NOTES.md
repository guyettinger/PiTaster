# Session 19 Notes: Local Model Context Budget

**Date**: 2026-08-30
**Status**: ✅ Complete
**Duration**: ~3 hours

## What Was Built

The agent now knows how much context it actually has, says what it is doing
while it recovers, spends the window on the right things, and stops itself when
it starts repeating. Three of the four were bug fixes, not features.

Verified live against `qwen3.8:27b-mlx` on Ollama 0.33.2: `models.json` went from
262144 to the served 65536, the context meter reads `3k / 66k`, and the stall
notice rendered `Waiting on the model — 30s so far` during a real prefill.

### Components Created

1. **`agent/context-budget.ts`** — one derived `ContextBudget`
   - Resolves the window: user override → `/api/ps` → advertised capped at 32768
   - Derives `maxTokens`, Pi's `compaction` thresholds, and the trimmer's cap
   - Holds `reserve + keepRecent < window * 0.9` by construction, tested 2k–256k

2. **`agent/context-trim.ts`** — Pi's `context` hook
   - Truncates long tool results with a marker naming how to re-read
   - Replaces a superseded `read` with a pointer to the newer one
   - Drops screenshots older than two turns
   - Never touches the system prompt, a user message, or the current turn

3. **`agent/loop-guard.ts`** — soft-blocks a third consecutive identical call

4. **`agent/stall-notifier.ts`** — times the silence Pi has no event for

5. **`docs/skills/working-notes/SKILL.md`** — the `NOTES.md` convention

### Changed

- `agent/ollama.ts` — `warmModel`, `getLoadedContextLength`,
  `prepareModelForSession`; `models.json` carries the budget, not the advertised
  maximum
- `agent/session.ts` — `buildPiSettings` (compaction, retry, idle timeout via
  `applyOverrides`), `resolveToolNames`, the trimmer and guard on the extension,
  post-compaction nudge
- `agent/events.ts` — compaction, retry and settle events become `status` chunks
- `agent/system-prompt.ts` — ~870 → ~430 tokens
- `ipc.ts` — approval timeout removed, `denyPendingApprovals`, warm-up status
- `Chat.tsx` — status strip and context meter; `Settings.tsx` — three new fields

## Decisions

**Discover the window, don't configure it.** `num_ctx` is not settable over
Ollama's OpenAI-compatible `/v1` endpoint. Warming the model before probing is
what makes `/api/ps` answer — and it moves the load off the user's first message,
which was invisible dead time.

**Believe a small advertised window, distrust a large one.** An advertised 8192
is honest; an advertised 262144 is the number that causes silent truncation. So
the advertised value is capped at 32768, never used raw.

**Pi's retry policy only.** Provider-level retries are set to 0. Pi's is the one
that emits `auto_retry_*`; retries underneath it are invisible and turn a
recoverable failure into a longer unexplained wait.

**No approval timeout at all.** The old 60s timeout did not fail safe — it
silently *denied* a call the user meant to allow, indistinguishable from a real
refusal, and stepping away for a minute is normal when a turn takes minutes.

**Trimming is not a filter.** It exists to save tokens. `.claude/rules/` now says
so explicitly, so nobody later mistakes it for a boundary.

## Deviations from Plan

- **Context usage rides the `complete` chunk** rather than a polling
  `agent:context-usage` IPC handler. It is the only moment usage changes, so a
  channel of its own was not worth it. `AgentHost.getContextUsage` was dropped.
- **The stall notifier moved to its own module** with injectable timings, because
  a 20-second timer cannot be tested in place.
- **Model warm-up status was not in the plan** and turned out to be necessary:
  the warm happens before the session exists, so the session's own stall notice
  never covers the longest wait in the app. Found by driving the real UI.
- **Crash-resume was dropped**, as agreed before implementation.

## Gotchas

**`turn_start` is not per user message.** Pi emits it once per inner-loop round —
assistant response plus its tool calls — `agent-loop.js:109`. The loop guard
originally reset there, which is exactly the granularity a stuck model repeats
at, so the streak was wiped between every repetition and the guard could never
fire. `agent_start` is the per-prompt event.

**Aborting a run does not settle a pending approval.** Pi passes the run's
`AbortSignal` as `beforeToolCall`'s *second* argument (`agent-loop.js:409`), but
`AgentSession` destructures only the first (`agent-session.js:224`) and drops it,
and `ToolCallEvent` carries no signal field. A `tool_call` handler awaiting user
approval therefore never learns the run was aborted. Every path that ends a run
has to deny pending approvals itself.

**Pi does not export `Settings` or `AgentMessage` from the package root.** Read
them off the things that consume them —
`Parameters<SettingsManager['applyOverrides']>[0]` and
`ContextEvent['messages'][number]` — rather than adding `pi-agent-core` as a
direct dependency.

**Pi's `ContextUsage.tokens` is null right after a compaction**, before the next
response re-establishes usage. There is nothing honest to show until then.

**The `context` hook runs before every provider request**, so a transform has to
be idempotent. Truncating already-truncated text re-truncates it and reports a
smaller, wrong number of dropped lines — caught only because the test asserted
idempotence.

**`/api/ps` answers only for a resident model.** `syncOllamaModels` deliberately
does not warm: opening Settings should not page a 20GB model into memory. That is
why Settings shows the conservative default until a session has run once.

**Runtime skills are not seeded automatically.** `docs/skills/*/SKILL.md` are
copies; `SkillsLoader` reads `~/.pitaster/skills`. `lookup-docs` from Session 18 was
never copied there either — there is no install step, and probably should be.
