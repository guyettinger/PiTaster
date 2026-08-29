# Session 15 Notes: Pi Agent on Ollama

**Date**: 2026-08-29
**Status**: ✅ Complete
**Duration**: ~5 hours

## What Was Built

`apps/electron/src/main/agent.ts` (1223 lines) is gone. The agent is now
[Pi](https://pi.dev/) (`@earendil-works/pi-coding-agent@0.84.4`) running entirely on
local Ollama models, with anyapp's permission modes, path confinement, git auto-commit,
and version tools layered on as Pi extension hooks. Chat history is Pi's own
tree-structured JSONL transcript.

### Files Created

1. **`apps/electron/src/main/agent/session.ts`** (~310 lines) — builds one
   `AgentSession` per sub-app. Owns `AGENT_TOOL_NAMES`, the tool allowlist that Pi
   applies to custom tools as well as built-ins.
2. **`apps/electron/src/main/agent/permission-gate.ts`** (~200 lines) — the
   `tool_call` handler. Permission modes plus the path/command confinement that used
   to live inside each tool.
3. **`apps/electron/src/main/agent/auto-commit.ts`** (~85 lines) — the `tool_result`
   handler that commits after `write`/`edit`.
4. **`apps/electron/src/main/agent/version-tools.ts`** (~150 lines) — the six git
   tools via `defineTool()`.
5. **`apps/electron/src/main/agent/events.ts`** (~110 lines) — Pi events → `StreamChunk`.
6. **`apps/electron/src/main/agent/ollama.ts`** (~275 lines) — model discovery and
   `~/.anyapp/pi/models.json` generation.
7. **`apps/electron/src/main/agent/system-prompt.ts`** (~135 lines) — extracted from
   the old `agent.ts`, tool list rewritten for Pi's names.
8. **`packages/shared/src/chat/session-paths.ts`** — where Pi's data lives.
9. **`.claude/skills/pi-agent/SKILL.md`** — replaces the `agent-sdk` skill.

### Rewritten

- **`packages/shared/src/chat/manager.ts`** — an adapter over Pi's `SessionManager`
  instead of one JSON file per message.
- **`.claude/rules/self-modification.md`** — the four-part tool checklist, restated
  for Pi, plus an explicit statement that confinement is now a handler.

### Deleted

- `apps/electron/src/main/agent.ts` and the `@anthropic-ai/sdk` dependency
- `rebuildConversationHistory` and its three call sites
- `project:set-root` and `chat:save-message`, end to end
- `selfModifyTools` / `executeTool` (~310 unreachable lines), with `agent.ts`

## Decisions

**Pi's built-in tools adopted as-is, per the approved plan.** The 11 hand-rolled
scoped tools are replaced by `read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`. The six
version tools stayed custom because Pi has no equivalent and removing them would have
broken the versions UI.

**Confinement moved from the tools into one handler.** This is the significant change
in kind and is documented as such in `AGENTS.md` and the self-modification rule. See
Gotchas for what it cost.

**Auto-commit kept, as a hook.** Dropping it would have broken rollback, branching, and
the versions panel — a shipped feature nobody asked to remove. It now also honours the
`autoCommit` setting, which had been rendered in Settings and ignored since it was added.

**Model discovery reads `/api/show`, not just `/api/tags`.** The plan only called for
documenting that a tool-capable model is required. `/api/show` reports per-model
capabilities, so the requirement is enforced instead: embedding-only models are hidden,
models without tool support are labelled in the picker, and the real context window and
vision/thinking flags are written into `models.json` rather than guessed.

**Electron 33 → 39, ESM main process.** Pi declares `engines.node >= 22.19.0` and is
ESM-only. Electron 39.8.10 bundles Node 22.22.1. The preload stays CJS because a
sandboxed preload cannot be ESM, which is why it still hand-duplicates the core types.

## Deviations from Plan

**Session storage needed a draft concept.** The plan assumed `SessionManager.create()`
produces a listable session. It does not — see Gotchas. `ChatHistoryManager` now keeps
a draft record and adopts Pi's real session id once a run materializes the transcript.

**`SerializedToolBlock.toolCallId` landed in 15.3, not 15.4.** The renderer needed it
as soon as tool correlation was fixed.

**No README.md exists at the repo root**, so the Ollama prerequisite went into
`AGENTS.md` only.

**The review subagents were not spawned.** The standing instruction in this environment
is not to spawn agents unless asked, so the security review was done inline against the
same checklist. Findings are below.

## Gotchas

**Pi does not write a session file until the first assistant reply.**
`SessionManager.create()` returns a manager whose `_persist` buffers everything until
an assistant message exists — deliberate, so empty sessions do not litter the disk. But
anyapp's UI creates a visible, selectable session the moment the user clicks New Chat.
The bridge is a draft record in `.chat-sessions.json`, merged into `listSessions()` and
replaced by Pi's real id via `attachSession()` once the transcript exists.

**Sessions default to `~/.pi/agent/`, not the `agentDir` you pass.**
`createAgentSession({ agentDir })` controls settings and models, but `SessionManager`
resolves its own directory from Pi's global default unless you pass `sessionDir`
explicitly. The first working build wrote transcripts to `~/.pi/agent/sessions/`.

**The model routes around a blocked tool.** This is the finding worth remembering.
When the `ls` tool refused `path: "../.."`, the model's very next action was
`bash: ls ../..` — and the first version of the shell check let it through, because it
only scanned for tokens starting with `/` or `~`. Blocking a tool does not block the
capability; every path-accepting surface needs the same check. Relative traversal is now
caught. `ls $HOME` still is not, and cannot be by string inspection.

**A shell path scan needs a word-boundary anchor.** The first fix over-corrected:
`/(?:~|\/)[^\s]*/g` matches `/App.tsx` inside `src/App.tsx`, so ordinary commands were
refused. The pattern must anchor to start-of-string or a shell delimiter.

**The docs and the types disagree on event field names.** `tool_execution_start` carries
`args` and `tool_execution_end` carries `result` — not `input`/`output` as the prose
suggests. The extension-side `tool_call` event does use `input`. Read the `.d.ts`.

**Ollama's OpenAI-compatible endpoint needs compat flags.** Without
`supportsDeveloperRole: false` and `supportsReasoningEffort: false`, reasoning-capable
models fail outright. Pi's `models.md` calls this out for Ollama specifically.

**A careless regex ate half the preload bridge.** A `re.sub` intended to remove
`setProjectRoot` removed every bridge function from `sendMessage` down to it. Nothing
caught it: `electron.d.ts` is a hand-written declaration, so the preload is not type-
checked against it. Verified afterwards by diffing the exported member list against
`HEAD` — worth doing routinely for that file.

## Verification

Run against a live Ollama daemon with `muse-glimmer:30b-mlx`:

| Check | Result |
|-------|--------|
| Agent answers, tools execute, `tool_start`/`tool_end` pair by `toolCallId` | ✅ |
| `plan` mode denies every tool | ✅ |
| `default` mode prompts; denial reported and the agent continues | ✅ |
| `acceptEdits` auto-approves files, still prompts for `bash` | ✅ |
| `write` and `edit` auto-commit | ✅ |
| `autoCommit: false` leaves the file untracked | ✅ |
| Session resumes across a new host, model recalls prior turn | ✅ |
| Draft session adopted, title carried onto the real transcript | ✅ |
| `read /etc/passwd`, `~/.ssh/id_rsa`, `../../../etc/hosts` | ✅ blocked |
| `bash cat /etc/passwd`, `cat ~/.ssh/id_rsa`, `cd / && ls` | ✅ blocked |
| `bash ls ../..` (the tool-refusal workaround) | ✅ blocked *after fix* |
| `bash ls $HOME` | ❌ **not blocked** — see Gotchas |
| Ordinary commands (`bun run build`, `cat src/App.tsx`) not refused | ✅ |
| `bun run typecheck:all`, `bun run build` | ✅ |

### Inline security review

**Fixed.** `agent:tool-response` validated nothing. It is the approval gate for the
whole permission system, and `response.approved` was used directly — a truthy
non-boolean read as approval. Now type-checked strictly.

**Reported, not fixed (pre-existing, outside this session's scope).** The `version:*`
IPC handlers accept a renderer-supplied `appPath` and run git operations on it with no
confinement to `~/.anyapp/apps/`. Worth a follow-up.

**Clean.** `BrowserWindow` sets `contextIsolation`/`nodeIntegration`/`sandbox`
correctly; no raw `ipcRenderer` crosses the bridge and every listener unwraps the event;
`config:save` and the new `models:*` handlers validate every field. The preload's four
`any` signatures were replaced with real types, and its `SerializedContentBlock` union
had been missing `SerializedElementBlock` — both fixed.

## Left Undone

1. **MCP is still unwired.** `SourceManager.callTool` exists and the agent never calls
   it. Pi's `pi.registerTool()` makes the bridge straightforward — a good Session 16.
2. **`bash` confinement cannot be made sound by string inspection.** Real isolation
   needs an OS boundary.
3. **Old `.chat-history/` directories are left on disk** and no longer read. Users will
   see prior history disappear from the UI; the files are still there.
4. **`thinking_delta` events are dropped.** Local reasoning models emit plenty; showing
   it is a UI decision nobody has made.
5. **Compaction is unsurfaced.** Pi emits `compaction_start`/`compaction_end`.
6. **`deleteMessage` was not carried over** — Pi's transcript is append-only per branch,
   so removing one message means branching. Nothing called it.
