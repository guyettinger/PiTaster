---
name: pi-agent
description: Reference for how anyapp embeds Pi (@earendil-works/pi-coding-agent) on Ollama - the SDK surface, event shapes, tool schemas, and the anyapp-specific hooks layered on top. Use when changing anything under apps/electron/src/main/agent/.
---

# Pi Agent Integration

anyapp's agent is [Pi](https://pi.dev/), embedded via `@earendil-works/pi-coding-agent`
and running on local Ollama models. The integration lives in
`apps/electron/src/main/agent/`.

Everything below was read from the installed type declarations, not the prose docs,
which differ in places.

## Module map

| File | Responsibility |
|------|----------------|
| `session.ts` | Builds one `AgentSession` per sub-app; owns the tool allowlist |
| `events.ts` | Pi session events → anyapp's `StreamChunk` |
| `permission-gate.ts` | `tool_call` handler: permission modes + path confinement |
| `auto-commit.ts` | `tool_result` handler: git commit after `write`/`edit` |
| `version-tools.ts` | The six git tools, via `defineTool()` |
| `mcp-tools.ts` | Bridges connected MCP sources' tools into Pi custom tools |
| `system-prompt.ts` | `getSystemPrompt(app)` and the per-template hints |
| `ollama.ts` | Model discovery and `~/.anyapp/pi/models.json` generation |
| `tool-guidance.ts` | Recovers Pi's per-tool `promptGuidelines`, which `systemPromptOverride` drops |
| `edit-repair.ts` | `tool_result` handler: turns a failed `edit` into the file's real text |
| `file-tools.ts` | `replace_lines`, the line-addressed edit that cannot fail on whitespace |
| `file-lines.ts` | Line splitting, joining and numbering shared by those two |
| `context-files.ts` | `agentsFilesOverride`: drops the `AGENTS.md` ancestry above the sub-app |

## Event shapes

```typescript
// @earendil-works/pi-agent-core — AgentEvent (relevant members)
| { type: "agent_start" }
| { type: "agent_end";   messages: AgentMessage[] }
| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
| { type: "tool_execution_end";   toolCallId: string; toolName: string; result: any; isError: boolean }

// @earendil-works/pi-ai — AssistantMessageEvent (relevant members)
| { type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
| { type: "error"; reason: "aborted" | "error"; error: AssistantMessage }
```

Note the naming: `tool_execution_start` carries **`args`** and `tool_execution_end`
carries **`result`** — not `input`/`output`. The *extension* `tool_call` event uses
`input`. Pi emits `tool_execution_start` exactly once per call, with complete
arguments.

## Extension hook returns

```typescript
interface ToolCallEventResult   { block?: boolean; reason?: string; terminate?: boolean }
interface ToolResultEventResult { content?: (TextContent | ImageContent)[]; details?: unknown; isError?: boolean; usage?: Usage }
```

Returning `{ block: true, reason }` turns the reason into the tool result and lets
the agent continue, which is how `plan` mode and denials behave.

## Built-in tool schemas

| Tool | Parameters | Required |
|------|-----------|----------|
| `read` | `path`, `offset`, `limit` | `path` |
| `write` | `path`, `content` | `path`, `content` |
| `edit` | `path`, `edits[{oldText,newText}]` | `path`, `edits` |
| `bash` | `command`, `timeout` | `command` |
| `grep` | `pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit` | `pattern` |
| `find` | `pattern`, `path`, `limit` | `pattern` |
| `ls` | `path`, `limit` | — |

Every path-bearing tool uses the key `path`, which is what makes confinement a
single lookup.

## Gotchas

- **`systemPromptOverride` silently discards every tool's prompt guidance.** Pi's
  `buildSystemPrompt` takes a `customPrompt` early return
  (`dist/core/system-prompt.js:13-34`) that appends the append-prompt, context files,
  skills and cwd — and drops `toolSnippets` and `promptGuidelines`. The four `edit`
  bullets in `editToolSystemPromptContribution` never reached the model until
  `agent/tool-guidance.ts` put them back. Anything Pi contributes through a tool
  definition has to be re-emitted by hand while the override is in place.
- **Pi's edit error misnames its own cause.** `fuzzyFindText`
  (`dist/core/tools/edit-diff.js:141-176`) already tolerates trailing whitespace, CRLF,
  BOM, NFKC, smart quotes, Unicode dashes and exotic spaces. `The old text must match
  exactly including all whitespace and newlines` fires on **leading indentation**,
  internal whitespace runs, or blank-line counts. There is no `replace_all` and
  uniqueness is a hard error.
- **`before_provider_request` is the only route to sampling.** Pi exposes no temperature
  anywhere. The handler's *return value replaces* the payload
  (`dist/core/extensions/runner.js:834-836` → `sdk.js` `onPayload`); mutating `event.payload`
  in place is not how that hook works, unlike `tool_call`'s `input`.
- **`tool_call` cannot rewrite arguments by return value** — `ToolCallEventResult` carries
  only `block`/`reason`/`terminate`. Arguments are patched by mutating `event.input` in
  place, with **no re-validation afterwards**. `tool_result` *can* return replacements for
  `content`, `details`, `isError` and `usage`, chained across extensions.
- **Pi discovers `AGENTS.md` by walking up from `cwd`**, and also reads `agentDir`. Pass
  `agentsFilesOverride` or a sub-app inherits whatever is above `~/.anyapp/apps/`.

- **`tools` is an allowlist that covers custom tools too.** A `defineTool()` tool
  missing from the session's `tools` array is silently dropped. `AGENT_TOOL_NAMES`
  is only the static base; MCP tool names are appended per session.
- **Pi has no MCP support.** Nothing in `@earendil-works/pi-coding-agent@0.84`
  mentions it — `mcp-tools.ts` is the whole bridge.
- **A raw JSON Schema is a valid `parameters` value.** `validateToolArguments`
  (`pi-ai/dist/utils/validation.js`) checks for TypeBox's kind symbol and falls
  back to JSON Schema coercion when it is absent, so an MCP `inputSchema` passes
  through with `as unknown as TSchema`. Required properties, enums, nested objects
  and string→number coercion all work. Do **not** wrap it in `Type.Unsafe` — that
  adds the brand and forces the TypeBox path instead.
- **Sessions default to `~/.pi/agent/`.** Pass an explicit `sessionDir` to
  `SessionManager.create/open/list` or transcripts land outside `~/.anyapp/`.
- **Pi defers writing a transcript until the first assistant reply.** An empty
  session does not exist on disk, which is why `ChatHistoryManager` keeps a draft
  record and adopts Pi's real session id once the run materializes the file.
- **`ImageContent` is flat**: `{ type, data, mimeType }` — not Anthropic's nested
  `source` with `media_type`.
- **Ollama needs compat flags.** Its OpenAI-compatible endpoint rejects the
  `developer` role and `reasoning_effort`; `models.json` disables both.
- **`Skill` needs `sourceInfo` and `disableModelInvocation`.** Build the first with
  the exported `createSyntheticSourceInfo`.
- **Node >= 22.19 and ESM.** Pi cannot be bundled — it uses `jiti` and ships WASM —
  so it stays external in `electron.vite.config.ts`.

## Docs

Pi's own documentation is at `packages/coding-agent/docs/` in
[earendil-works/pi](https://github.com/earendil-works/pi); `sdk.md`, `models.md`,
and `extensions.md` are the relevant ones.
