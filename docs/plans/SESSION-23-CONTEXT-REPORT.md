# Session 23 — The context report

## Why

The context meter added in Session 19 showed one number, `12k / 66k`, and showed it
less than half the time. The reported symptom was "the context usage graph doesn't show
all the time." The cause was not one guard but five, and two more problems sat behind it:
the number could not be acted on, and nothing said what was taking the space.

**Why it hid.**

1. `Chat.tsx` rendered the meter behind `contextUsage && …`, and the state started `null`.
2. `agent:get-context-usage` answered off `agentHost`, a lazily-created singleton built
   only by the `agent:message` handler. Before the first completed turn there was
   nothing to ask.
3. `disposeAgentHost()` fires on an app switch, a cleared chat, session create/delete/
   switch, every skills save or toggle, every sources change, and every config save.
   Each one took the meter back to nothing until another turn finished.
4. The renderer cleared the value again on a session change.
5. Pi reports `ContextUsage.tokens` as `null` immediately after a compaction — the
   moment the number matters most.

**Why it could not be acted on.** `used / window` carried no mark for
`window - reserveTokens`, which is where the agent actually stops to summarize. The
whole of `ContextBudget` was computed in main and never crossed to the renderer.

**Why nothing was attributed.** No breakdown existed anywhere. The only token counter in
the codebase was `estimateTokens(text)` in `packages/shared/src/skills/tokens.ts`, used
for the Skills page alone.

## The idea that made it work

**The fixed half of a request needs no session to measure.** The system prompt, the tool
schemas, Pi's restored tool guidance, the skill manifest and the app's `AGENTS.md` are
pure functions of the app and its configuration. So a report can be built cold — no
`ModelRuntime`, no model warm, no TypeScript service — and the meter always has an honest
number, even before the first prompt.

Pi's per-message estimator (`estimateTokens(message: AgentMessage)`) is exported from the
package root and supplies the conversation half when a session exists.

## What was built

**`agent/context-report.ts`** — `buildContextReport(params)`. Fixed blocks always;
conversation blocks from `session.state.messages` when a session is passed. Four states:
`live`, `estimated`, `stale`, `floor`. All four render.

**`agent:get-context-report`** in `ipc.ts` — deliberately never calls `ensureAgentHost`,
which would warm the model. Caches the last live report so `disposeAgentHost` degrades to
`stale` rather than to nothing, and recomputes the fixed blocks fresh so a toggled skill
shows a smaller manifest immediately.

**`agent:compact`** — the first thing in Key Lime Pi to call Pi's `session.compact()`.
Refused mid-turn.

**`ContextMeter.tsx` / `ContextBreakdown.tsx` / `useContextReport.ts`** — the meter moved
out of `Chat.tsx` and now renders unconditionally. Hover opens the card with a close
delay so the pointer can reach its actions; click pins it; Escape and an outside click
dismiss it. The card is a stacked bar with a rust compaction tick, a legend grouped
**Fixed** / **Conversation**, the largest individual tool results, and a footer that
states the measured total and the estimated block sum side by side.

## Decisions

**Show the seam, do not close it.** The total is the provider's own accounting; the
blocks are chars/4. They disagree, and the footer says so rather than scaling the blocks
to fit. A breakdown that always sums to the measured total is one that has been made to.

**Measure the prompt's parts, not the whole.** `getSystemPrompt` inlines the manifest,
the MCP section and the tool guidance. Measuring the whole and the parts would charge the
user twice per skill, and turning one off would appear to shrink two blocks.

**Price images by difference.** Subtracting the image-stripped estimate from the whole
recovers Pi's per-image charge exactly, without Key Lime Pi restating a constant that is not
its to know.

**Build tool definitions, never run them.** Sizing a schema calls every factory with
stubbed callbacks. Nothing calls `execute`; nothing acquires a TypeScript service.

**Colors rank within a group, not by id.** Keyed by id, the second-largest block could
draw in the palest tone the ramp has, which reads as a measurement bug.

**Two families, not eleven hues.** Ash for the fixed half, brass for the conversation,
rust for the compaction tick — the palette `globals.css` already commits to.

## Deviations from plan

- **The superseded `agent:get-context-usage` channel was removed**, along with its
  preload function and `AgentHost.getContextUsage`. The plan said to leave the usage path
  alone; once nothing in the renderer called it, leaving a dead renderer-facing IPC
  channel was worse than removing it. `readContextUsage` and `StreamChunk.contextUsage`
  stay — the former still supplies the report's `measured`.
- **`apps:set-active` now forgets the cached report only when the app actually changes.**
  Found by driving the real app: navigating Apps → back into the open chat re-selects the
  same app, and unconditional invalidation dropped the meter to its fixed floor on the
  trip a user makes to return to the conversation it describes.
- **The `floor` copy was rewritten.** It said "what this conversation starts at", which is
  a lie on a cold launch that resumed a fifty-turn transcript. It now says the
  conversation is counted from the next turn, which is true in both cases.
- **"Summarize now" is disabled outside a live session.** In `stale` it would have
  answered a click with "No conversation to compact yet" — not even true there.
- **The report handler checks `agentHost.appId === app.id`**, from the security review.
  Not exploitable today, but the invariant was held by convention across ten call sites
  and `apps:delete` already breaks it.

## Gotchas

**`session.ts` cannot be imported from a `bun test`.** It reaches
`ts-service/registry`, which imports Electron's `utilityProcess`. `context-report.test.ts`
spells out the tool names rather than importing `resolveToolNames`.

**`confineContextFiles` is a filter, not a reader.** It cannot be asked what Pi would have
found. The report reads `AGENTS.md`/`CLAUDE.md` from the app root directly, which is
exactly what survives that filter.

**`ToolDefinition.parameters` is TypeBox, which is a plain JSON Schema object at runtime**,
so `JSON.stringify` gives very nearly what the provider is sent.

**Pi's `estimateContextTokens` is not exported from the package root**, though
`estimateTokens` is.

## Verification

`bun run typecheck:all` clean; `bun test` 320 pass, including 8 new. Driven in the built
app with the `run-app` skill against a live Ollama model: the floor before any turn, the
live report after one, the stale report surviving a skill toggle (with the manifest block
recomputed from 10 enabled/712 to 8 enabled/576), and the daemon-reported window replacing
the 32.8k fallback once the model warmed.

Reviewed by `electron-security-reviewer` and `self-modification-auditor`. The auditor
found nothing. The security reviewer found the app-id gap fixed above, and flagged a
**pre-existing** issue outside this change: `apps:set-active` validates `id` only as a
non-empty string and never against `appManager.listApps()`, while `AppManager.getApp`
joins it onto `APPS_DIR` with no containment check — unlike `resolveAppRoot`, which exists
for exactly this reason. Left for its own session.
