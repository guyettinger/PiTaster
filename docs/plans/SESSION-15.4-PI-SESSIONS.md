# Session 15.4: Pi Sessions

## Overview

Retire Key Lime Pi's own chat persistence in favour of Pi's session tree, then clean up the
documentation that still describes the Anthropic agent.

`packages/shared/src/chat/manager.ts` (373 lines) writes one JSON file per message under
`~/.keylimepi/apps/<appId>/.chat-history/<sessionId>/`. Pi's `SessionManager` writes a
tree-structured JSONL transcript with `id`/`parentId` links, supporting branch and fork.

**Estimated scope**: Medium (~2 hours)
**Prerequisites**: Session 15.3 complete
**Deliverable**: Sessions persist through Pi with full tool fidelity, and switching
sessions no longer discards the model's context.

## Objectives

1. Rewrite `ChatHistoryManager` as an adapter over Pi's `SessionManager`.
2. Map Pi transcript entries to `PersistedMessage`, keeping tool calls intact.
3. Delete `rebuildConversationHistory` and its lossy text-only flattening.
4. Update the docs that still describe the old agent.

---

## Task 1: ChatHistoryManager over SessionManager

| Existing API | Pi equivalent |
|---|---|
| `listSessions(appId)` | `SessionManager.list(app.path)` → map to `ChatSession` |
| `createSession(appId, params)` | `SessionManager.create(app.path)` |
| `deleteSession(appId, id)` | delete the session file |
| `renameSession(appId, id, title)` | `sm.appendLabelChange(entryId, title)` |
| `loadHistory(appId, sessionId)` | `SessionManager.open(path).getPath()` → `PersistedMessage[]` |
| `saveMessage(...)` | **deleted** — Pi persists on its own |
| `getActiveSessionId` / `setActiveSession` | keep in `~/.keylimepi/apps/<appId>/.chat-sessions.json` |

Pi has no notion of an "active" session, so the manifest survives — reduced to just the
active-session pointer.

`ChatSession.messageCount` comes from `sm.getEntries().length`.

`agentDir` stays global at `~/.keylimepi/pi` so `models.json` and `settings.json` are
shared; `cwd` (the sub-app path) does the per-app partitioning, so sessions land under
`~/.keylimepi/pi/sessions/<slug-of-app-path>/`.

`Chat.tsx` currently calls `saveChatMessage` on send and on `complete`. Those calls, and
the `chat:save-message` channel (`ipc.ts:552`), go away.

---

## Task 2: PersistedMessage mapping

Pi entries → `SerializedContentBlock[]`:

- assistant text → `SerializedTextBlock`
- tool calls → `SerializedToolBlock`

**Add `toolCallId` to `SerializedToolBlock`** (`packages/core/src/chat.ts:20`). Its
absence is the reason history cannot be replayed today — there is no way to pair a
`tool_use` with its `tool_result`.

`SerializedElementBlock` and `SerializedApprovalBlock` have no Pi equivalent. Store them
as Pi custom entries via `pi.appendEntry(customType, data)` so the transcript stays
complete and round-trips.

Also reconcile the two tool-status unions. `MessageBubble.tsx:53` has
`'pending' | 'running' | 'complete'`; `SerializedToolBlock` has those plus `'error'`.
`Chat.tsx:60` maps `'error'` → `'complete'` on load, which silently hides failures. Add
`'error'` to the UI union and render it.

---

## Task 3: Delete rebuildConversationHistory

`ipc.ts:178-193` filters persisted messages down to their `text` blocks and joins them,
so every `tool_use`, `tool_result`, and image is dropped from the model's context on app
or session switch. Delete it, along with its three call sites: `apps:set-active`
(`ipc.ts:444`), `sessions:delete` (`ipc.ts:607`), and `sessions:set-active`
(`ipc.ts:639`).

Switching sessions now means constructing an `AgentSession` over that session file, at
full fidelity. `agent:clear-history` (`ipc.ts:223`) becomes "start a new Pi session".

**Migration: clean break.** Existing `.chat-history/` directories are left on disk,
untouched and no longer read. New sessions start empty. Users will see their history
disappear from the UI, so say plainly in the notes and the release note that the files
are still there and where they are.

---

## Task 4: Documentation

| File | What is wrong |
|------|---------------|
| `AGENTS.md` | Says the agent is "built directly on the Anthropic Messages API: `@anthropic-ai/sdk` with ~25 hand-rolled tools". Rewrite for Pi + Ollama, including the Ollama prerequisite. |
| `AGENTS.md` → Safety rules | Path confinement is now enforced in the `tool_call` gate, not inside each tool. The Credentials rule no longer has a subject. |
| `.claude/rules/self-modification.md` | `paths:` is `apps/electron/src/main/agent*.ts`; widen to `apps/electron/src/main/agent/**/*.ts`. Rewrite the four-part tool-registration checklist for Pi. |
| `.claude/skills/agent-sdk/SKILL.md` | Describes the Claude Agent SDK as the candidate replacement. Replace with a Pi reference, or delete. |
| `packages/shared/src/index.ts:1` | Header comment claims "Agent wrapper (Claude Agent SDK)" — already false before this session. |
| `docs/plans/README.md` | Tech Stack table says "AI: Anthropic SDK". Also missing a row for `SESSION-11-CHAT-SESSIONS.md`, and Session 13 is marked `Planned` despite all three sub-sessions having NOTES files. |
| `README.md` | Document `ollama serve` and pulling a tool-capable model. |

---

## Verification

- [ ] `bun run typecheck:all` passes
- [ ] A new session persists across an app restart
- [ ] The session list shows correct titles and message counts
- [ ] Switching apps switches session sets
- [ ] Deleting and renaming sessions work
- [ ] Sessions appear under `~/.keylimepi/pi/sessions/`
- [ ] A failed tool renders as an error, not as a completed call
- [ ] **Fidelity check** — send a message that uses a tool, restart the app, reopen the
      session, and ask a follow-up that depends on the earlier tool result. This is
      impossible today.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/chat/manager.ts` | **Rewritten** over `SessionManager` |
| `packages/core/src/chat.ts` | **Modified** — `toolCallId` on `SerializedToolBlock` |
| `packages/shared/src/index.ts` | **Modified** — stale header comment |
| `apps/electron/src/main/ipc.ts` | **Modified** — delete `rebuildConversationHistory` and `chat:save-message` |
| `apps/electron/src/renderer/src/components/Chat.tsx` | **Modified** — drop `saveChatMessage`, render tool errors |
| `apps/electron/src/renderer/src/components/MessageBubble.tsx` | **Modified** — `'error'` tool status |
| `AGENTS.md` | **Modified** — Pi + Ollama, safety rules, credentials |
| `.claude/rules/self-modification.md` | **Modified** — Pi tool registration checklist |
| `.claude/skills/agent-sdk/` | **Replaced** — Pi reference |
| `docs/plans/README.md` | **Modified** — tech stack, missing/incorrect rows |
| `README.md` | **Modified** — Ollama prerequisite |

---

## Commit Checkpoint

```bash
bun run typecheck:all && bun run build

git add -A
git commit -m "$(cat <<'EOF'
feat(chat): persist sessions through Pi's SessionManager

Replaces the one-JSON-file-per-message store with Pi's tree-structured JSONL
transcript, and deletes rebuildConversationHistory, which flattened history to
text blocks and dropped every tool call and image on session switch.

- SerializedToolBlock gains toolCallId so history can actually be replayed
- tool errors now render as errors instead of being mapped to 'complete'
- existing .chat-history/ directories are left on disk but no longer read

Docs updated for Pi + Ollama across AGENTS.md, .claude/rules, and README.
EOF
)"
```

---

## Final Session Commit

Session 15 is complete once this lands. Write `SESSION-15-NOTES.md` covering all four
sub-sessions, and flip the index rows to `Complete`. The Gotchas section should carry
the escape-attempt results from 15.3 and the honest assessment of the bash confinement
check.

## Session Complete

- ✅ The agent runs on local Ollama models with no API key
- ✅ Cancellation works
- ✅ Tool calls correlate correctly under parallel execution
- ✅ Session history round-trips with full fidelity
- ✅ ~1600 lines of hand-rolled agent and chat-store code deleted
