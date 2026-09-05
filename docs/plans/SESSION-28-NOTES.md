# Session 28 Notes: Multiple Workspaces, and a Rail That Fits

**Date**: 2026-09-05
**Status**: ✅ Complete
**Duration**: ~1 day, six phases

## What Was Built

Three UI complaints turned out to share one root cause, and fixing it properly meant
making the app genuinely multi-workspace.

The nav rail was `w-20` **because of a word** — its own comment said so: the eyebrow
rendered "Workspace" at 71px and a 64px rail clipped it. Skills sat in the rail as a
global destination while enable/disable state is `SubApp.disabledSkills`, per app, so
with no app open every toggle on the page was disabled. And Settings' General tab ran
permissions, Ollama server, model, context window, tool set, temperature, top-p,
reasoning effort, trim, theme, auto-commit and auto-title in one column.

Underneath all three: `activeAppId`, a single module global in `ipc.ts` that ~63
handlers read, and that **was** the confinement root. One app at a time was not a
policy, it was a consequence of how the state was stored.

So: the rail lists open apps as tiles — the app name *is* the destination, which is how
the word "Workspace" left the rail and the rail narrowed to `w-16`. Skills moved into
the app's dock and its library into Settings. Settings split into five tabs. And main
grew a workspace registry, so several sub-apps hold a live agent, a live transcript and
a pending approval at once, with token generation serialized behind one visible queue.

### Components Created

1. **`main/workspaces.ts`** + **`workspaces.test.ts`** (21 tests)
   - `WorkspaceRuntime` holds what used to be six module globals: `host`,
     `activeSessionId`, `permissionMode`, `cachedReport`, `telemetry`, `runActive`,
     plus new `hostStale` and `lastUsedAt`
   - `withWorkspace(appId: unknown, run)` — the single funnel from a renderer-supplied
     id to a confinement root
   - `hostsToEvict` — LRU cap of 4 live hosts, never evicting a workspace that is
     mid-turn, holding an approval prompt, or on screen
   - The refusal test enumerates rather than samples: `''`, `'.'`, `'..'`, `'../..'`,
     `'../../tmp'`, `'a/b'`, `'a\b'`, `'/etc/passwd'`, `'a\0b'`, `'weather:stream'`, a
     5000-char id, `null`, `undefined`, `42`, `{}`, `[]`, and a well-formed id naming
     no app

2. **`main/inference-queue.ts`** + tests (10 tests)
   - `InferenceQueue.acquire(appId)` returns a ticket carrying `waitingBehind`, so the
     caller can send a `queued` status *before* it starts waiting
   - `cancel(appId)` abandons a queued turn without touching the daemon
   - `InferenceCancelled` is a distinct type so a stopped queued turn ends quietly
     rather than reporting a failure it did not have

3. **`main/serialize.ts`** + tests (7 tests)
   - One promise chain per key, in front of `session-baselines.ts`,
     `layout-store.ts` and `broadcastSessions`
   - The first test demonstrates the hazard rather than asserting the fix: an
     unserialized read-modify-write of two keys loses one

4. **`main/open-apps-store.ts`** + tests (12 tests)
   - `~/.pitaster/open-apps.json`, capped at 4, pruned against live app ids

5. **`renderer/components/workspace/MountedWorkspace.tsx`**
   - One per open app, all mounted; the unfocused ones hidden with
     `clip-path: inset(100%)` and `inert`
   - Exists for callback identity: `WorkspaceContext`'s value must stay memoized, which
     needs stable callbacks bound to one app — something a component that knows about
     four cannot produce

6. **`renderer/components/shell/AppTile.tsx`**, **`hooks/useOpenApps.ts`**
   - The rail's open-app tiles, with a per-tile busy dot and a hover close button

7. **`renderer/components/settings/{ModelTab,AgentTab,GeneralTab,controls,types}.tsx`**
   - `Settings.tsx` went from 729 lines to a shell; Model carries live daemon health
     from the existing `useDaemonHealth` hook rather than the one-shot Check button

8. **`renderer/components/skills/{AppSkillsPanel,WorkspaceSkillsSettings,filterSkills}`**
   - `SkillsPanel.tsx` deleted and split in two: the app's dock panel holds both
     sections with per-app toggles and a manifest-cost header; Settings → Skills
     authors the workspace library with no toggles at all

9. **`workspace:open` IPC channel**
   - `apps:set-active` is focus and nothing else now

### Changed, worth naming

- **~40 handlers gained an `appId`**; `resolveAppRoot` and its active-app fallback are
  deleted
- **All eight preload `off*` functions** were `removeAllListeners` and are gone;
  subscribers return an unsubscribe and filter on an appId. Seven push channels became
  `{ appId, ... }` envelopes
- **`state/agentActivity.ts` is keyed by app id**, with a new `useBusyAppIds` feeding
  the rail's dots
- **`AgentStatusKind` gained `'queued'`** (`packages/core`)
- **`prepareModelForSession` is single-flight**, keyed by daemon + model + override

## Decisions

**The honest ceiling on "concurrent" is one turn at a time.** One Ollama daemon, one
loaded model. Two turns generating at once either queue *inside* the daemon with no
headers sent — indistinguishable from prefill, so the stall notifier apologises for a
queue, `retry-budget` can cut a turn that never started, and telemetry books queue time
as prefill, corrupting the `prefillRate` behind *"~1 min to prefill if the cache
misses"* for every workspace — or, under `OLLAMA_NUM_PARALLEL>1`, the daemon splits the
loaded context across slots, `/api/ps` reports the aggregate, and `deriveContextBudget`
sizes compaction against a window the model does not have. That is the silent
head-truncation *"The context window is not what Ollama advertises"* exists to prevent,
arriving from a new direction. So: N transcripts, N approvals, N TypeScript services,
tools genuinely parallel — generation serialized, with the wait *visible*.

**A workspace is a sub-app, not an app + chat.** Two chats concurrently in one app would
put two `VersionManager` writers on one `.git/index` for no benefit.

**`permissionMode` is per workspace, and that is security-relevant.** It is read at
every `tool_call`, so one global meant a mode chosen for one app widened what another
app's in-flight turn was allowed to do.

**Refusal, not a lock, for rollback / branch switch / install.** A lock that queues for
several minutes is indistinguishable from one that did nothing. These are things a
person asked for *now*.

**A mid-turn host is marked stale, not disposed.** Killing a background turn because
someone saved a setting is a worse failure than a turn finishing under the configuration
it started with — the user sees a run they did not stop end with no explanation, in an
app they were not looking at. Teardown forces it, because there is no later moment.

**The cap is on hosts, not runtimes.** A runtime is a few fields and every app-addressed
channel creates one, so counting those would evict a live conversation because a file
was read from the Apps page. A host is a Pi session, a transcript and a whole
`ts.LanguageService` program in its own `utilityProcess`.

**Tiles are name monograms, not template glyphs.** Every app made from one template
carries the same glyph, so a rail of three React apps was three identical tiles
distinguishable only by position.

## Deviations from Plan

- **`LAYOUT_VERSION` was not bumped.** The plan said to bump it for the new `skills`
  panel kind. `defaultLayout.ts` documents the opposite rule in its own comment — a
  purely additive kind touches no existing id, so a layout saved before it restores
  exactly as written, and bumping throws away every user's arrangement to gain nothing.
  Followed the code and extended its comment.
- **`apps:set-active` became focus-only in Phase 6, not Phase 2.** Phase 2 left the
  session bootstrap in it. It only became wrong once several workspaces were mounted, at
  which point bootstrapping only the focused one leaves the others with no session — so
  the split into `workspace:open` happened where the need appeared.
- **No `gitLock` and no `hostBuild`.** The plan listed both on `WorkspaceRuntime`. The
  git concern is served by `refuseWhileRunning` (see Decisions); `hostBuild` had no
  caller once `hostStale` covered the invalidation case.
- **`broadcastSessions` is coalesced, not debounced.** The plan said debounce. It goes
  through `serialize` keyed per app instead, which gets the same "no overlapping
  end-to-end transcript reads" without a timer whose delay would be arbitrary.
- **`syncedAppId` is gone.** Phase 1 added it to gate the workspace mount on main
  agreeing which app was active. Once every channel names its app, the race it guarded
  cannot happen and the gate was pure latency.

### Also done, not in the plan

- **`.claude/skills/run-app` fixes.** `tab` matched by prefix and `focus <name>` did not
  exist. See Gotchas — the first cost a whole diagnosis.
- **`runActive` widened to the whole turn.** Found by driving the built app, not by
  reading it. See Gotchas.

## Gotchas

**`visibility: hidden` cannot hide a dock, and it looks like it can.** `visibility` is
inherited *and* a descendant may override it back to `visible` — which dockview does,
explicitly (`style.visibility = "visible"` on the overlay of every active panel). Setting
it on the workspace wrapper hides the chrome and leaves the panels painted on top of
whatever is focused. `display: none` is also wrong, for a different reason: it removes
the box, and Chat's auto-scroll reads `scrollHeight`, Monaco needs real dimensions, and
dockview measures its container to lay out the grid. `clip-path: inset(100%)` clips the
subtree, cannot be overridden from inside it, and leaves layout alone. `inert` handles
focus and pointer events.

**`innerText` under-reports a clipped subtree, and it reads exactly like a stalled
turn.** While verifying that a background workspace kept streaming, its `innerText`
froze at 1160 chars for two minutes. `innerText` approximates *rendered* text;
`textContent` is layout-independent and showed 4772 and climbing. The measurement was
broken, not the app. Now in the run-app skill's gotchas.

**The driver's `tab` matched by prefix, so `tab Chat` activated *Chats* — and reported
OK.** This produced a phantom "the Chat panel renders empty" regression that survived a
context compaction as the session's top open bug. There was never a regression. A test
harness that reports success for the wrong target is worse than one that fails: it costs
a diagnosis. `tab` now matches exactly before falling back to a prefix.

**`runActive` around `sendPrompt` alone leaves a window minutes long.** Queueing behind
another app and loading a 32GB model both happen *before* the first token, with Stop
showing the whole time. During that window `runActive` was false, so a rollback was
accepted — and the turn then started against a working tree that had moved. This was
found by trying the refusal in the real app and watching it not fire; it is invisible in
the source, where the flag looks correctly placed.

**One `settled` flag on a queue ticket is not enough.** With a boolean, an app that had
a turn running *and* a second queued would, on cancelling the queued one, release the
running one's hold on the daemon — because `finish` is keyed by app id and cannot tell
the two apart. Three states (`queued` / `running` / `cancelled`) fix it. There is a test.

**A cancelled ticket nobody awaited is an unhandled rejection**, and Electron ends the
main process on one. The `.catch(() => {})` is attached at `acquire`, not in `wait`.

**Switching a sub-app to a pre-rebrand branch makes the app vanish from the Apps list.**
Found by accident while probing the new refusals: `main` on an older app predates the
rebrand and has no `.pitaster-meta.json`, so checking it out deletes the file from the
working tree and `listApps` drops the app entirely — no error, no explanation. The
directory is still there and switching back restores it. **Not fixed this session.**

**An unanswered approval prompt in one app blocks every other app's turn.** The
inference ticket is held across the whole turn, including tool execution and approval,
so a Deny/Allow card left open anywhere stops the queue. The `queued` status names the
app being waited on, which makes it discoverable rather than mysterious, but it is a real
consequence of serializing on the daemon and **has not been decided on**.

**The activity store had to be keyed, and the symptom would have been subtle.** As a
single reading, a background app finishing a turn bumped the *focused* app's
`turnRevision` — refetching its context report and its changed-files strip against a
conversation that had not moved — and filed the cost line and the written files under
the wrong transcript.

**Two of the four `.claude` review agents' findings were stale prose, not code.**
`files.ts` still credited confinement to `resolveAppRoot`, deleted in this session. On a
security boundary that is the worst kind of stale comment: it sends a reader looking for
a check in a file that does not have one.

## Review

Both read-only subagents ran over `808bbbc..HEAD` and came back clean.

`electron-security-reviewer` enumerated all 33 `appId: unknown` call sites and confirmed
each resolves through `withWorkspace` or `optionalWorkspace` before touching a root, that
nothing calls `appManager.getApp` with renderer input outside `workspaces.ts`, that the
preload never lets the IPC event cross and every channel name is a fixed literal, and
that all four ways an approval ends *resolve* rather than reject.

`self-modification-auditor`'s most useful finding is a negative one: **the tool surface
is byte-identical to `808bbbc`.** `permission-gate.ts`, `session.ts`, every tool module
and all of `packages/shared` have zero diff, so no tool was added, removed or
reclassified and `PLAN_READ_TOOLS` is unchanged. All five rebrand-sensitive strings
verified intact.

Three loose ends they named were fixed in `6c1f1d1`: `apps:install-deps` now goes
through `withWorkspace` like every other app-addressed channel, the stale `resolveAppRoot`
prose is corrected, and the dead `focusedRuntime` export is gone.

## Left Undone

- **AGENTS.md is not yet updated** — the nav-rail description, the singleton-panel rule
  (the bridge is fixed, so the constraint is lifted and is now a product decision), and a
  new section on what concurrency does and does not mean.
- **Two pre-existing IPC validation gaps**, confirmed by both reviewers to be outside
  this session's hunks: `sessions:rename` bounds its title's type but not its length,
  unlike the session id beside it; `chat:add-element-context` does not validate its
  `ElementContext` shape or its base64 screenshot's size. Neither reaches a path, shell
  or the permission gate.
- **The approval-blocks-the-queue behaviour** needs a decision: accept it, or release the
  ticket across tool execution.
- **The pre-rebrand branch switch bug** described in Gotchas.
- **Phase 1's rail busy dots were placeholder until Phase 6**, which is as planned; they
  are live now.
