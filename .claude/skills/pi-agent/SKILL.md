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
| `system-prompt.ts` | `getSystemPrompt(app)` and the per-template hints |
| `ollama.ts` | Model discovery and `~/.anyapp/pi/models.json` generation |

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
| `edit` | `path`, `edits` | `path`, `edits` |
| `bash` | `command`, `timeout` | `command` |
| `grep` | `pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit` | `pattern` |
| `find` | `pattern`, `path`, `limit` | `pattern` |
| `ls` | `path`, `limit` | — |

Every path-bearing tool uses the key `path`, which is what makes confinement a
single lookup.

## Gotchas

- **`tools` is an allowlist that covers custom tools too.** A `defineTool()` tool
  missing from `AGENT_TOOL_NAMES` is silently dropped.
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
