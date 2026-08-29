# Session 15.3: Pi Agent Core

## Overview

Delete `apps/electron/src/main/agent.ts` (1223 lines) and replace it with
`apps/electron/src/main/agent/`, built on Pi's `AgentSession`. This is the sub-session
that actually swaps the engine.

All API shapes below were read from the installed
`@earendil-works/pi-coding-agent@0.84.4` type declarations, not from the docs.

**Estimated scope**: Large (~3 hours)
**Prerequisites**: Sessions 15.1 and 15.2 complete
**Deliverable**: The agent answers on a local Ollama model, tools pair correctly in
the UI, all four permission modes behave, and the stop button works.

## Objectives

1. Host one Pi `AgentSession` per active sub-app.
2. Adapt Pi's event stream to `StreamChunk`, and make `StreamChunk` single-source.
3. Reimplement the permission gate and path confinement as a `tool_call` handler.
4. Re-add per-write git auto-commit as a `tool_result` handler.
5. Port the six version tools to `defineTool()`.
6. Wire cancellation end to end — it has never existed.

---

## Verified Pi API surface

```typescript
// @earendil-works/pi-agent-core — AgentEvent
| { type: "agent_start" }
| { type: "agent_end";   messages: AgentMessage[] }
| { type: "turn_start" }
| { type: "turn_end";    message: AgentMessage; toolResults: ToolResultMessage[] }
| { type: "message_start" | "message_end"; message: AgentMessage }
| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
| { type: "tool_execution_start";  toolCallId: string; toolName: string; args: any }
| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
| { type: "tool_execution_end";    toolCallId: string; toolName: string; result: any; isError: boolean }

// @earendil-works/pi-ai — AssistantMessageEvent (relevant members)
| { type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
| { type: "error"; reason: "aborted" | "error"; error: AssistantMessage }

// tool_call handler return
interface ToolCallEventResult { block?: boolean; reason?: string; terminate?: boolean }

// tool_result handler return
interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[]; details?: unknown; isError?: boolean; usage?: Usage
}
```

Note `tool_execution_start` carries **`args`**, and `tool_execution_end` carries
**`result`** — not `input`/`output` as the prose docs suggest. The `tool_call`
extension event uses `input`.

### Built-in tool schemas

| Tool | Parameters | Required |
|------|-----------|----------|
| `read` | `path`, `offset`, `limit` | `path` |
| `write` | `path`, `content` | `path`, `content` |
| `edit` | `path`, `edits` | `path`, `edits` |
| `bash` | `command`, `timeout` | `command` |
| `grep` | `pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit` | `pattern` |
| `find` | `pattern`, `path`, `limit` | `pattern` |
| `ls` | `path`, `limit` | — |

Every path-bearing tool uses the key `path`. That makes confinement a single lookup.

### What Pi does with paths

`core/tools/path-utils.js` → `resolveToCwd(filePath, cwd)` expands `~`, strips an `@`
prefix, normalizes unicode spaces, and resolves against `cwd`. **It performs no
containment check** — an absolute path or `~/...` passes straight through. This is the
whole reason Task 3 exists.

`resolveReadPath` additionally tries NFD, curly-quote, and macOS AM/PM basename
variants. Those only vary the basename, never the directory, so a containment check on
the `resolveToCwd` result remains sound.

---

## Task 1: agent/session.ts — the session host

One `AgentSession` per active sub-app, rebuilt when `apps:set-active` fires. This
replaces the module-global `conversationHistory: MessageParam[]` (`ipc.ts:40`); Pi owns
history in `session.agent.state.messages` and persists it through `SessionManager`.

```typescript
const { session } = await createAgentSession({
  cwd: app.path,
  agentDir: join(homedir(), '.anyapp', 'pi'),
  model,
  modelRuntime,
  thinkingLevel: 'off',
  noTools: 'all',
  tools: [
    'read', 'write', 'edit', 'bash', 'grep', 'find', 'ls',
    'create_branch', 'switch_branch', 'list_branches',
    'get_history', 'rollback', 'git_status'
  ],
  customTools: createVersionTools(app.path),
  resourceLoader: loader,
  sessionManager,
  settingsManager
})
```

`tools` is an allowlist that applies to custom tools too — a custom tool omitted from
the list is filtered out.

The model comes from `ModelRuntime`:

```typescript
const modelRuntime = await ModelRuntime.create({
  authPath: join(agentDir, 'auth.json'),
  modelsPath: join(agentDir, 'models.json')
})
const model = modelRuntime.getModel('ollama', config.ollamaModel)
```

Export a small host with `sendPrompt`, `abort`, `dispose`, and `getMessages`. Call
`dispose()` on app switch and from `cleanupIpcHandlers`.

---

## Task 2: agent/events.ts — Pi events → StreamChunk

First make `StreamChunk` single-source. It is currently duplicated four times and has
already drifted — `packages/core/src/agent.ts:24` and `preload/index.ts:7` are missing
`input` and `output`. Keep the `@anyapp/core` copy, delete the rest, add `toolCallId`:

```typescript
/**
 * A single streamed update from the agent to the renderer.
 */
export interface StreamChunk {
  /** What kind of update this is. */
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error' | 'rate_limit'
  /** Assistant text delta, for `text`. */
  text?: string
  /** Tool name, for `tool_start` and `tool_end`. */
  tool?: string
  /** Stable id correlating a `tool_start` with its `tool_end`. */
  toolCallId?: string
  /** Tool arguments, for `tool_start`. */
  input?: Record<string, unknown>
  /** Truncated tool output, for `tool_end`. */
  output?: string
  /** Error message, for `error`. */
  error?: string
  /** Seconds until the retry, for `rate_limit`. */
  retryAfterSeconds?: number
}
```

Mapping:

| Pi event | `StreamChunk` |
|---|---|
| `message_update` / `text_delta` | `{ type: 'text', text: e.assistantMessageEvent.delta }` |
| `tool_execution_start` | `{ type: 'tool_start', tool: e.toolName, toolCallId: e.toolCallId, input: e.args }` |
| `tool_execution_end` | `{ type: 'tool_end', tool: e.toolName, toolCallId: e.toolCallId, output: summarize(e.result), error? }` |
| `agent_end` | `{ type: 'complete' }` |
| `message_update` / `error` | `{ type: 'error', error }` |

Keep `summarizeOutput`'s 500-character truncation (`agent.ts:72`). Ignore
`turn_*`, `queue_update`, `compaction_*`, and `thinking_delta` for now.

Pi emits `tool_execution_start` **once, with complete arguments**, so two renderer bugs
can be fixed at the same time:

- `Chat.tsx:233` currently hunts for a running block with no input and patches it,
  because the old loop emitted `tool_start` twice. That collapses to a plain push.
- `Chat.tsx:268` matches `tool_end` to "the first block whose status is running",
  which mis-associates under parallel tool use. It becomes a `toolCallId` match.

---

## Task 3: agent/permission-gate.ts — the gate

An `InlineExtension` passed through `DefaultResourceLoader({ extensionFactories })`.
With Pi's built-in tools adopted as-is, this handler is the **only** thing between the
model and the filesystem, so it carries both the mode check and the confinement that
used to live inside each tool.

```typescript
pi.on('tool_call', async (event): Promise<ToolCallEventResult | undefined> => {
  const violation = checkConfinement(event, rootPath)
  if (violation) return { block: true, reason: violation }

  const decision = checkPermission(getMode(), event.toolName)
  if (decision.behavior === 'deny') return { block: true, reason: decision.message }
  if (decision.behavior === 'ask') {
    const approved = await requestApproval(event.toolName, event.input)
    if (!approved) return { block: true, reason: 'Denied by user' }
  }
  return undefined
})
```

`checkConfinement` resolves the way Pi will — expand `~`, strip a leading `@`, resolve
against `cwd` — then rejects anything outside `rootPath`:

- `read` / `write` / `edit` / `grep` / `find` / `ls`: the `path` argument, when present
- `bash`: the `command` string against `BLOCKED_COMMANDS` (`agent.ts:25`), plus any
  absolute or `~`-rooted path token that falls outside `rootPath`

**Be honest about the bash check.** Shell command strings are not reliably parseable;
substitution, quoting, and indirection all defeat token scanning. This is the concrete
point where the new guarantee is weaker than the old one, where `run_command` only ever
ran with `cwd: rootPath` and the file tools could not be handed an absolute path at all.
Do not describe it as confinement in comments or notes.

`checkPermission` ports from `agent.ts:821-872` with Pi's tool names:

```typescript
const fileTools = ['read', 'write', 'edit', 'grep', 'find', 'ls']
const versionTools = [
  'create_branch', 'switch_branch', 'list_branches',
  'get_history', 'rollback', 'git_status'
]
// 'bash' is deliberately absent -> falls through to 'ask'.
// Anything unclassified also falls to 'ask', never 'allow'.
```

`plan` still denies every tool. The approval round-trip through `ipc.ts:254-277` and
`agent:tool-response` (`ipc.ts:306`) is unchanged, including its 60-second
deny-on-timeout — pass the `requestApproval` closure into the extension factory.

---

## Task 4: Cancellation

`session.abort()` exists. The wiring around it never has: `runAgentQuery` accepts a
`signal` and checks it at `agent.ts:1116`, but `ipc.ts` never passes one, and there is
no `AbortController` or stop button anywhere in the repo.

- `ipcMain.handle('agent:abort', ...)` in `ipc.ts`
- `abortAgent: () => ipcRenderer.invoke('agent:abort')` in `preload/index.ts`, declared
  in `renderer/src/types/electron.d.ts`
- a stop button in `Chat.tsx`, shown while `isStreaming` — the send button currently
  just reads "Thinking..." and is inert

---

## Task 5: agent/auto-commit.ts

```typescript
pi.on('tool_result', async (event): Promise<ToolResultEventResult | undefined> => {
  if (!autoCommit()) return undefined
  if (event.toolName !== 'write' && event.toolName !== 'edit') return undefined
  if (event.isError) return undefined

  const relativePath = relative(rootPath, resolveToRoot(event.input.path, rootPath))
  try {
    await new VersionManager(rootPath).commit({
      message: `${event.toolName}: ${relativePath}`,
      files: [relativePath]
    })
  } catch (err) {
    // Surface it. Rollback depends on every write having a commit.
    return { content: [...event.content, { type: 'text', text: `\n[commit failed: ${(err as Error).message}]` }] }
  }
  return undefined
})
```

This also unifies two implementations that exist today: the scoped tools call
`git.add`/`git.commit` from `isomorphic-git` directly (`agent.ts:213-220`, `290-297`)
while the dead `write_source` uses `VersionManager.commit` (`agent.ts:698`). Standardise
on `VersionManager`, keeping
`AUTHOR = { name: 'anyapp Agent', email: 'agent@anyapp.local' }` (`agent.ts:22`).

This is the first time the `autoCommit` setting is actually read — it has been rendered
in Settings and ignored since it was added.

---

## Task 6: agent/version-tools.ts

Pi has no equivalent for anyapp's git tools, so they are ported rather than dropped.
`defineTool` takes a single options object.

```typescript
import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { VersionManager } from '@anyapp/shared'

/**
 * Build the git/version tools for one sub-app.
 * @param rootPath - Absolute path to the sub-app root
 * @returns Pi tool definitions backed by {@link VersionManager}
 */
export function createVersionTools(rootPath: string): ToolDefinition[] {
  const vm = new VersionManager(rootPath)

  return [
    defineTool({
      name: 'rollback',
      label: 'Rollback',
      description: 'Roll the app back to a previous commit.',
      parameters: Type.Object({
        commit: Type.String({ description: 'Commit SHA to roll back to' })
      }),
      execute: async (_toolCallId, { commit }) => ({
        content: [{ type: 'text', text: await describeRollback(vm, commit) }],
        details: {}
      })
    })
    // create_branch, switch_branch, list_branches, get_history, git_status
  ]
}
```

Behaviour matches `agent.ts:308-458`, including returning errors as text rather than
throwing, so the model always gets a usable result.

---

## Task 7: System prompt, skills, element context

**System prompt** — `DefaultResourceLoader({ systemPromptOverride: () => getSystemPrompt(app) })`.
Keep `TEMPLATE_HINTS` (`agent.ts:889-932`) and the `## Element Context` section
(`agent.ts:980-999`). **Rewrite the hand-maintained `## Available Tools` list
(`agent.ts:959-970`)** — it names tools that will no longer exist. Delete the unused
`BASE_SYSTEM_PROMPT` (`agent.ts:1003`).

Tool names are hardcoded in five places today: `createScopedTools`, that markdown list,
the `checkPermission` allow-lists, `InlineApproval.getSummary()`, and `ToolBubble`. All
five need Pi's names.

**Skills** — keep anyapp's `SkillsLoader` (`~/.anyapp/skills/<name>/SKILL.md`) and feed
the result through `DefaultResourceLoader({ skillsOverride })`, mapping `@anyapp/core`'s
`Skill` (`{name, description, content, filepath}`) to Pi's
(`{name, description, filePath, baseDir, source: 'custom'}`). This preserves the
`docs/skills/` seed content and retires `buildSystemPrompt`'s string concatenation
(`skills/loader.ts:169`).

**Element context** — `session.prompt(text, { images })` takes pi-ai `ImageContent`.
Rework `agent-utils.ts:convertElementContextToContent` to return `{ text, images }`.
Pi uses **`mediaType`** (camelCase); Anthropic used `media_type`. Drop the local
`ClaudeContentBlock` mirror (`agent-utils.ts:10-21`) and the cast at `agent.ts:1080`.

---

## Task 8: Deletions

Delete `apps/electron/src/main/agent.ts`. Confirm nothing still imports:

- `MessageParam` (`agent.ts:81`, re-exported into `ipc.ts:12`)
- `selfModifyTools` (502-655) and `executeTool` (663-813) — ~310 unreachable lines
- `setProjectRoot` / `getProjectRoot`, and with them the `project:set-root` channel
  (`ipc.ts:215`), its preload method, and its `electron.d.ts` entry

Remove `@anthropic-ai/sdk` from `apps/electron/package.json`.

---

## Verification

- [ ] `bun run typecheck:all` passes
- [ ] `grep -rn "@anthropic-ai/sdk" apps/ packages/` returns nothing

With `ollama serve` running and a tool-capable model selected:

1. [ ] Ask the agent to read a file — `tool_start`/`tool_end` render once, paired
2. [ ] Ask it to read two files at once — parallel blocks resolve to the correct
       bubbles (this fails today)
3. [ ] `default` mode + a write — approval prompt appears; approve; `git log` in
       `~/.anyapp/apps/<id>` shows the commit
4. [ ] Deny — the agent reports the block and keeps going
5. [ ] `plan` mode — every tool denied
6. [ ] `acceptEdits` — writes auto-approve, `bash` still prompts
7. [ ] Start a long run, press stop — streaming halts
8. [ ] Turn `autoCommit` off — writes no longer commit

### Escape attempts (record results verbatim in the notes)

9. [ ] `read /etc/passwd` — blocked
10. [ ] write to `~/escape.txt` — blocked
11. [ ] `bash: cat ~/.ssh/id_rsa` — blocked
12. [ ] `read ../../../../etc/hosts` — blocked
13. [ ] `bash: cd / && ls` — record the actual result; the token scan may not catch this

Step 13 is expected to be the weak one. Write down what actually happens rather than
what should happen.

14. [ ] Run `electron-security-reviewer` over `src/main/` and `src/preload/`
15. [ ] Run `self-modification-auditor` over `src/main/agent/`

The auditor's four-part registration checklist now maps to: the tool is in the `tools`
allowlist, classified in the gate's allow-lists, covered by `checkConfinement`, and
covered by auto-commit if it writes.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/electron/src/main/agent.ts` | **Deleted** (1223 lines) |
| `apps/electron/src/main/agent/session.ts` | **New** — `AgentSession` host |
| `apps/electron/src/main/agent/events.ts` | **New** — Pi events → `StreamChunk` |
| `apps/electron/src/main/agent/permission-gate.ts` | **New** — mode gate + confinement |
| `apps/electron/src/main/agent/auto-commit.ts` | **New** — `tool_result` → `VersionManager` |
| `apps/electron/src/main/agent/version-tools.ts` | **New** — six tools via `defineTool()` |
| `apps/electron/src/main/agent/system-prompt.ts` | **New** — `getSystemPrompt` + `TEMPLATE_HINTS` |
| `apps/electron/src/main/agent-utils.ts` | **Modified** — pi-ai `ImageContent` |
| `apps/electron/src/main/ipc.ts` | **Modified** — session host, `agent:abort`, drop `project:set-root` |
| `apps/electron/package.json` | **Modified** — drop `@anthropic-ai/sdk` |
| `apps/electron/src/preload/index.ts` | **Modified** — `abortAgent`, shared `StreamChunk` |
| `apps/electron/src/renderer/src/types/electron.d.ts` | **Modified** — same |
| `apps/electron/src/renderer/src/components/Chat.tsx` | **Modified** — `toolCallId`, stop button |
| `apps/electron/src/renderer/src/components/InlineApproval.tsx` | **Modified** — Pi tool names |
| `packages/core/src/agent.ts` | **Modified** — canonical `StreamChunk` + `toolCallId` |

---

## Commit Checkpoint

```bash
bun run typecheck:all && bun run build

git add -A
git commit -m "$(cat <<'EOF'
feat(agent): replace the Anthropic loop with Pi on Ollama

Deletes agent.ts (1223 lines) in favour of a Pi AgentSession per sub-app.

- Pi's built-in read/write/edit/bash/grep/find/ls replace the 11 scoped tools
- permission modes and path confinement move into a tool_call handler
- per-write git auto-commit moves into a tool_result handler, and now honours
  the autoCommit setting for the first time
- the six version tools are ported to defineTool()
- StreamChunk is single-source in @anyapp/core and gains toolCallId, fixing
  tool_end mis-association under parallel tool use
- cancellation is wired end to end for the first time

Path confinement is now enforced by a handler rather than by the tools
themselves; see SESSION-15.3-NOTES.md for the escape-attempt results.
EOF
)"
```
