# Session 26: The Instrument Row

## Overview

Four strips now stack above the chat input, and each was designed alone:
`DaemonHealthStrip` (a rust sentence), `AgentStatusStrip`/`TurnSummaryStrip` (sharing one
slot), and `ChangedFilesStrip` (file chips plus its own popover). Worst case the composer
grows four lines of text before the box you type into — and because every strip renders
conditionally, the box *moves* as the agent works: a warning appears, a turn ends, a file
is written.

The information is right; the presentation is a pile.

Meanwhile `agent/telemetry.ts` already records a 64-request ring buffer — per-request
prefill ms, first-token ms, total ms, prompt/prefilled/cached/output tokens, a cache
verdict, and median prefill and decode rates — and **none of it reaches the renderer**.
The UI sees one `TurnCost` riding the `complete` chunk and discards the rest. There is a
panel's worth of measured data with no way to look at it.

This session replaces the four strips with **one fixed-height row of four gauges**, each
with a hover card carrying a small chart and an action that opens a full dock panel, and
exposes the telemetry buffer so those panels have something to draw.

**Estimated scope**: Medium (~3 hours)
**Prerequisites**: Sessions 23, 24, 25 complete
**Deliverable**: A composer whose height never changes, and three dockable panels —
Activity, Daemon, Changes — reachable from the gauge that summarizes each.

## Objectives

1. One `AgentGaugeRow` above the input, holding Activity, Daemon, Context and Changes.
   Every gauge renders always; nothing appears or disappears under the text box.
2. One hover/pin mechanic (`GaugePopover`), extracted from `ContextMeter` and shared by
   all four, replacing the second, weaker copy in `ChangedFilesStrip`.
3. A fault colours its gauge and *replaces its label* rather than adding a line, so a
   dead daemon is legible without hovering and without moving the composer.
4. `agent:get-telemetry` over IPC, exposing the snapshot main already builds.
5. Three new dock panels, none of them in the default layout.
6. Charts drawn by hand — no chart library.

---

## Anatomy

```
 ● 43s ▁▂▅▂   ◐ qwen3-coder   ▇▇░ 31k/65k   ⛁ 4 files ±94
┌────────────────────────────────────────────────────────┐
│ Ask the agent about my-app…                    [Send]  │
└────────────────────────────────────────────────────────┘
 ⏵ Accept edits                             Clear this chat
```

| Gauge | Resting | Working | Card | Action |
|---|---|---|---|---|
| Activity | last turn's duration + a sparkline of recent request times; dot coloured by the last cache verdict | pulsing dot in `status.kind`'s colour + the status detail, truncated | the turn line, a per-request prefill/decode chart, a verdict ribbon, session totals | Open Activity |
| Daemon | `◐ <model>` | unchanged | reachable, model loaded, TTL bar, measured rates, window + `windowSource` | Open Daemon |
| Context | `ContextMeter`, moved unchanged | unchanged | `ContextBreakdown`, unchanged | Manage skills / Summarize now |
| Changes | `N files ±churn` + mini diffstat | `Writing <path>` in brass | the existing `FileGroup`/`FileRow`/`DiffView` list | Open Changes |

---

## Task 1: Telemetry types move to core

The renderer renders these now, so they belong beside `TurnCost` and `CacheVerdict`
rather than in a main-process module.

### packages/core/src/telemetry.ts

Move `RequestOutcome`, `ProviderRequestRecord`, `TelemetryTotals` and
`TelemetrySnapshot` verbatim from `apps/electron/src/main/agent/telemetry.ts`, TSDoc
included — every comment on those fields is load-bearing, particularly the one on
`reasoningTokens` explaining that a zero means "not reported" on Ollama.

### apps/electron/src/main/agent/telemetry.ts

Re-export them, the way `CacheVerdict` and `TurnCost` already are:

```typescript
export type {
  CacheVerdict,
  ProviderRequestRecord,
  RequestOutcome,
  TelemetrySnapshot,
  TelemetryTotals
}
```

Nothing else in that module changes.

---

## Task 2: `agent:get-telemetry`

### apps/electron/src/main/ipc.ts

```typescript
// What the daemon has been asked to do for the conversation on screen.
//
// Deliberately not `ensureAgentHost`, for the same reason `agent:get-context-report`
// is not: building a host warms the model, and this handler runs whenever the
// Activity panel mounts. `sessionTelemetry` is module-scoped and survives
// `disposeAgentHost`, which is exactly what makes answering without a host correct
// rather than a compromise.
ipcMain.handle('agent:get-telemetry', async (): Promise<TelemetrySnapshot> => {
  return sessionTelemetry.snapshot()
})
```

No arguments, so there is nothing to validate. `snapshot()` already copies its records
and totals (`records.map((record) => ({ ...record }))`, `{ ...totals }`), so the value
structure-clones across IPC safely.

### apps/electron/src/preload/index.ts

```typescript
getTelemetry: (): Promise<TelemetrySnapshot> => {
  return ipcRenderer.invoke('agent:get-telemetry')
},
```

Plus the matching entry in `renderer/src/types/electron.d.ts` and the interface
declarations the preload file keeps beside its other DTOs.

---

## Task 3: The activity store

Panels cannot subscribe to `agent:stream` — `offAgentStream` is
`removeAllListeners('agent:stream')`, so a second subscriber tears down `Chat`'s on
unmount. They also must not read this off `WorkspaceContext`, whose value is memoized
precisely so a per-turn bump does not re-render every panel.

So: a module-level external store, read with `useSyncExternalStore`. Only subscribers
re-render.

### apps/electron/src/renderer/src/state/agentActivity.ts

```typescript
/**
 * What the agent is doing right now, for everything that is not the transcript.
 *
 * A module store rather than a context, for two reasons that are both structural.
 * `WorkspaceContext`'s value is memoized so that a bump does not re-render every panel
 * — a per-turn revision on it would undo exactly what that memoization buys. And the
 * stream itself can only have one subscriber: `offAgentStream` is
 * `removeAllListeners('agent:stream')`, so a panel that listened would tear down the
 * transcript's subscription when it unmounted.
 *
 * `Chat` is the sole writer, which means that with the Chat panel closed the live
 * status goes quiet. That is acceptable and deliberate: nothing can start a turn with
 * no composer, and the *measured* half — the telemetry the Activity panel draws — comes
 * from main over IPC and stays correct regardless.
 */
export interface AgentActivity {
  /** What the agent is doing while it is not producing tokens, or null. */
  status: AgentStatus | null
  /** What the last finished turn cost, or null before one has finished. */
  lastTurn: { turn: TurnCost; cache: CacheVerdict } | null
  /** Paths the agent has written this turn. */
  pendingPaths: readonly string[]
  /** The file being written right now, or null. */
  writingPath: string | null
  /** Bumped when a turn completes. Drives every refetch keyed on a turn boundary. */
  turnRevision: number
}

export function publishActivity(patch: Partial<AgentActivity>): void
export function beginTurn(): void
export function endTurn(turn?: TurnCost, cache?: CacheVerdict): void
export function useAgentActivity(): AgentActivity
```

Implemented as a frozen snapshot object plus a `Set<() => void>` of listeners;
`getSnapshot` returns the same object identity until something actually changes, which
is what keeps `useSyncExternalStore` from looping.

`Chat.tsx` then drops its `status`, `lastTurn`, `pendingPaths`, `writingPath` and
`turnRevision` `useState` calls and publishes into the store from the chunk handler it
already has, reading the values back with `useAgentActivity()`. Its transcript state
does not move.

---

## Task 4: `GaugePopover`

`ContextMeter.tsx` already has the whole pattern — hover to open, `CLOSE_DELAY_MS` so
the pointer can travel into the card, click to pin, Escape and a capture-phase outside
`pointerdown` to unpin. `ChangedFilesStrip` has a second copy that is click-only, uses
`mousedown`, and has no travel delay.

### apps/electron/src/renderer/src/components/GaugePopover.tsx

```typescript
/**
 * Props for the GaugePopover component.
 */
export interface GaugePopoverProps {
  /** What the row shows: the gauge itself. */
  trigger: ReactNode
  /** The card, rendered only while open. */
  children: ReactNode
  /** Accessible name for the trigger. */
  label: string
  /** Whether there is anything to show. A gauge with no card is not a button. */
  hasCard?: boolean
}
```

Behaviour lifted from `ContextMeter` unchanged, including the two ways out a pinned card
needs. All four gauges use it; `ContextMeter` keeps its bar and figures as the `trigger`
and loses its own effect bodies.

---

## Task 5: The charts

No chart library. `CodeBlock.tsx` makes the bundle argument for lowlight and the Monaco
work makes it for tokenizers; four sparklines are the same trap. `StatBar` and
`ContextBreakdown`'s segmented bar are the precedent for what these look like.

### apps/electron/src/renderer/src/components/charts/

- `Sparkline.tsx` — one bar per recent request, height by total ms, with `StatBar`'s
  floor rule (`Math.max(0.08, …)`) so a fast request still draws something. An all-zero
  series renders flat rather than dividing by zero.
- `SplitBar.tsx` — prefill against decode within one request, two tones of one family.
- `VerdictRibbon.tsx` — one cell per request coloured by `CacheVerdict`. The cheapest
  possible read of whether the prefix cache is holding.

Colour follows the thesis `ContextBreakdown.tsx` states: brass is the agent acting,
patina is history, rust is something wrong, ash recedes. Ranked fills are assigned by
position, never by id — keyed by id, the second-largest value can draw in the palest
tone the ramp has, which reads as a bug in the measurement.

Two icons join `components/icons/index.tsx`: `PulseIcon` and `DaemonIcon`.

---

## Task 6: The gauges and the row

### apps/electron/src/renderer/src/components/DaemonGauge.tsx

The fault goes in the *label*, which is what lets the row keep a fixed height and still
say what is wrong to someone who is not hovering:

```typescript
/**
 * What the gauge reads, and in what colour.
 *
 * A fault replaces the resting label rather than adding a line. The row's height is
 * fixed — that is the whole point of it — so an escalating sentence is not available,
 * and a colour alone would leave a person whose turn just failed with nothing to read
 * unless they happened to hover.
 */
export function describeDaemon(health: DaemonHealth | null, model: string): DaemonReading
```

Five states, all tested: unknown (before the first poll), unreachable, model not loaded,
about to unload, healthy. The thresholds come from the existing `UNLOAD_WARNING_MS`.

### apps/electron/src/renderer/src/components/ActivityGauge.tsx

`summarizeActivity` decides between three readings — streaming (the status dot and
detail), idle-with-a-turn (duration plus sparkline), and never-run (a dimmed em dash).
It keeps `TurnSummaryStrip`'s refusal to render a summary of zero requests: a summary of
zero is worse than no summary.

### apps/electron/src/renderer/src/components/AgentGaugeRow.tsx

One flex row, `mx-auto max-w-3xl`, fixed height, four gauges in order. Every gauge
renders always — a gauge that disappears is what made the old composer jump. With
nothing changed, the Changes gauge reads a dimmed `no changes` rather than vanishing.

`ChangedFilesStrip` reduces to its gauge and card; `collectChangedFiles`, `shortLabels`,
`FileGroup`, `FileRow`, `Stat` and `StatBar` all survive, and the list half is exported
so the Changes panel renders the same rows. `DaemonHealthStrip.tsx` and
`TurnSummaryStrip.tsx` are deleted, and `AgentStatusStrip` comes out of `Chat.tsx`.

---

## Task 7: Three panels

### apps/electron/src/renderer/src/components/workspace/catalog.ts

```typescript
export const WORKSPACE_PANEL_NAMES = [
  'chats', 'files', 'server', 'chat', 'code', 'history',
  'terminal', 'preview', 'activity', 'daemon', 'changes'
] as const
```

All three `singleton: true` — every panel but Code is, and for a reason that is not
tidiness: each `off*` in the bridge is `removeAllListeners`.

**None joins `defaultWorkspaceLayout()`.** A workspace that opened an instrument panel
before you asked would assert you came here to read gauges, which is the same argument
that keeps Code out of the default.

**`LAYOUT_VERSION` stays at 1.** Nothing existing is renamed, removed, or given a new
`params` meaning, so a layout saved against v1 still restores correctly; bumping would
throw away every user's arrangement for a purely additive change. The comment on
`LAYOUT_VERSION` currently says to bump when "adding a panel" — amend it to distinguish
an additive kind from a change that invalidates what is already saved.

### The panels

- **ActivityPanel** — session totals (requests, prefilled against reused tokens with a
  reuse bar, invalidations, wall time spent prefilling), a request table with a
  prefill/decode split bar and a verdict cell per row, and the measured rates.
- **DaemonPanel** — model, reachability, TTL, rates, the window and where the figure
  came from. Reads `getDaemonHealth`, `getConfig`, `getContextReport` and
  `getTelemetry`; no new main-side work.
- **ChangesPanel** — `useSessionChanges` unchanged, keyed on the store's `turnRevision`
  plus `changesRevision`, rendering the extracted file list at full panel height.

### apps/electron/src/renderer/src/hooks/useTelemetry.ts

Fetches on mount and on `turnRevision`, and polls at ~1s **only** while the newest
record's `outcome === 'pending'`, so an idle panel makes no calls at all.

---

## Verification

Unit tests are `bun:test` with no DOM, so they cover the pure functions — the shape
`ChangedFilesStrip.test.ts` already uses:

- `describeDaemon` across all five states, including that a fault replaces the label.
- `summarizeActivity` idle, mid-turn, and before any turn has run.
- Sparkline scaling: the floor, and an all-zero series.
- `telemetry.test.ts` extended for the snapshot shape after the type move.

```bash
bun run typecheck:all
bun test
```

End to end, with the `run-app` skill — it drives the **built** app, and `bun run dev` is
the human path the driver attaches to neither half of:

1. Launch, open an app, screenshot the composer. Four gauges before any turn, the
   context gauge already reading its floor number.
2. Send a prompt. The Activity gauge switches to the live status dot, the Changes gauge
   to `Writing <path>` — and **the input box does not move** at any point.
3. On completion, hover each gauge: the card opens, the pointer can travel into it, and
   its action opens the right panel. The Activity panel's request count matches the
   turn line.
4. `ollama stop <model>` while idle. The Daemon gauge goes rust and its label reads the
   fault; the row's height is unchanged.
5. Close and reopen the Chat panel, then open Activity — the telemetry still reads
   correctly from main. Only the live status dot is affected by the store's one writer.
6. Restart. A layout saved before this session still restores, and the three new kinds
   are available from the Panels menu.
