# Session 16 Notes: MCP Tools on the Agent

**Date**: 2026-08-29
**Status**: ✅ Complete

## What Was Built

Tools advertised by connected MCP sources now reach the agent. Every tool on every
connected source becomes a Pi custom tool named `mcp__<sourceId>__<toolName>`,
gated by the existing permission modes — and enabled sources connect on their own
at startup instead of waiting for a click.

Before this, the whole sources feature terminated in the Sources panel. A user
could add a server, connect it, and read its tool list; `session.ts` never
referenced `SourceManager`, so the agent saw Pi's seven built-ins and the six
version tools and nothing else.

### Files Created

1. **`apps/electron/src/main/agent/mcp-tools.ts`** (~250 lines) — the bridge.
   Namespacing (`qualifyMcpToolName`, `isMcpToolName`), binding resolution
   (`getMcpToolBindings`), and one `defineTool()` per advertised tool
   (`createMcpTools`). Follows `version-tools.ts`: no handler throws, so a failed
   call reaches the model as text.
2. **`docs/plans/SESSION-16-MCP-TOOLS.md`** — the plan.

### Changed

- **`agent/session.ts`** — `mcpSources` param and `callMcpTool` callback. MCP names
  are appended to the `tools` allowlist and the tools to `customTools`.
  `AGENT_TOOL_NAMES` is now documented as the static base rather than the whole set.
- **`agent/permission-gate.ts`** — an explicit `ask` branch for MCP names, above the
  `acceptEdits` block. They already fell through to `ask`; the branch makes it
  deliberate so a later edit cannot grant auto-approval by accident.
- **`agent/system-prompt.ts`** — object parameter, plus a `## Connected Sources`
  section listing every bound tool by its exact callable name.
- **`main/ipc.ts`** — `initializeSources()`, host wiring, `disposeAgentHost()` on
  every source mutation, and real validation on `sources:save`.
- **`main/index.ts`** — `void initializeSources()` on ready, off the first-paint path.
- **`AGENTS.md`**, **`.claude/skills/pi-agent/SKILL.md`**, **`docs/plans/README.md`**.

## Key Decisions

**MCP tools are gated like `bash`.** `plan` denies, `default` and `acceptEdits`
ask, `bypassPermissions` allows. `checkConfinement` cannot police an MCP tool: it
carries no anyapp-resolved path, it runs inside a separate process the user
configured, and its reach is whatever that server exposes. Approval is the entire
boundary, so `acceptEdits` must not silence it.

**Namespaced names.** Without `mcp__<sourceId>__`, a server advertising `read` or
`bash` would shadow a built-in. The prefix doubles as the permission gate's key.
Names are sanitized to `[A-Za-z0-9_-]`, capped at 64 characters for Ollama's
OpenAI-compatible endpoint, and de-duplicated if truncation collides.

**Rebuild the session rather than mutate it.** Pi fixes its tool list at session
creation and `ExtensionAPI.registerTool` runs at extension-factory time. The source
handlers call `disposeAgentHost()`; the next prompt rebuilds against the same Pi
session file, so the transcript survives and only the tool set changes.

**`sources:save` is now validated properly.** It previously checked only that
`config.id` was a string. That payload names a command anyapp spawns *and* becomes
part of the agent's tool surface, so it now checks `type`, id charset, field
lengths, argument count, and a flat string env record.

## What We Learned

**Pi 0.84 has no MCP support.** Nothing in `@earendil-works/pi-coding-agent@0.84.4`
mentions it. `defineTool()` is the only route in.

**Pi accepts a raw JSON Schema as `parameters`.** `validateToolArguments`
(`pi-ai/dist/utils/validation.js:280`) checks for TypeBox's kind symbol and falls
back to JSON Schema coercion when it is absent, so an MCP `inputSchema` passes
through with `as unknown as TSchema`. Wrapping it in `Type.Unsafe` would add the
brand and force the TypeBox path instead — the opposite of what is wanted.

The plan was scoped around a risk that Pi's validator would choke on real MCP
schemas. Probed against the function directly, it does not: `required` is enforced,
`enum` violations rejected, nested objects and arrays validated, and `"2"` coerced
to `2` for a `number` property. The `prepareArguments` fallback was not needed.

**MCP's image block is already Pi's.** Both are flat
`{ type: 'image', data, mimeType }` — no Anthropic-style `source`/`media_type`
nesting to unwrap. `resource` and `audio` blocks are serialized to text so nothing
is silently dropped.

## Verification

- `bun run typecheck:all` and `bun run build` both clean; the app boots.
- Bridge unit behavior exercised directly: namespacing, sanitization, 64-char
  truncation, disconnected sources skipped, schema passthrough, text/image/other
  block mapping, and errors-as-text.
- Pi's `validateToolArguments` run against real MCP-shaped schemas (see above).
- **Live end-to-end** against `@modelcontextprotocol/server-filesystem`: connect →
  14 tools discovered → bound to `mcp__probe-fs__*` → Pi validated the server's own
  schema → `list_directory` returned real content → an out-of-root read came back
  as the server's `isError` refusal, mapped to text → clean disconnect.

## Not Done

Steps that need a human at the UI: the permission-mode matrix (deny in `plan`,
prompt in `acceptEdits`), denying a prompt mid-run, and disconnecting a source
mid-session. The code paths are the existing ones — `checkPermission` and
`disposeAgentHost` — but they were not exercised through the running app.

Also untouched: `api` and `filesystem` source types still throw
`Source type X not yet implemented` in `SourceManager.connect`.
