# Session 16: MCP Tools on the Agent

## Overview

Key Lime Pi has had a complete MCP stack since Session 4, extended with full CRUD in
Session 12 — and the agent has never been able to use any of it. A user could add
an MCP server, connect it, and watch the Sources panel list its tools, while
`apps/electron/src/main/agent/session.ts` went on offering Pi's seven built-ins
plus the six version tools and nothing else. Connecting a source was a dead end.

This session bridges every tool advertised by a connected MCP source into a Pi
custom tool, gated by the existing permission modes.

**Estimated scope**: Medium
**Prerequisites**: Session 4 (Sources), Session 12 (Source CRUD), Session 15 (Pi agent)
**Deliverable**: The agent can call tools on connected MCP servers, with approval

## Why This Matters

- MCP servers are the primary way to extend the agent past its own filesystem.
  Without this, the entire sources feature is decorative.
- The `enabled` flag on `SourceConfig` was written on save and read by nothing, so
  every source went cold on restart.
- Pi 0.84 has no MCP support of its own — nothing in
  `@earendil-works/pi-coding-agent` mentions it. The bridge has to be Key Lime Pi's.

## Current State

| Layer | Status | Details |
|-------|--------|---------|
| `packages/core/src/sources.ts` | Complete | `McpSourceConfig`, `ConnectedSource`, `McpTool` |
| `packages/shared/src/sources/mcp-client.ts` | Complete | stdio transport, env filtering, `callTool` |
| `packages/shared/src/sources/manager.ts` | Complete | configs, connections, `callTool`, `getConnectedSources` |
| IPC + preload + `SourcesPanel` | Complete | add, edit, delete, connect, disconnect, tool listing |
| **Agent** | **Missing** | `session.ts` never referenced `SourceManager` |

## Design decisions

**Auto-connect enabled sources at startup.** The `enabled` flag finally does
something. Connection is per-source and failures are non-fatal.

**MCP tools are gated like `bash`.** `plan` denies, `default` and `acceptEdits`
ask, `bypassPermissions` allows. This is the security-relevant choice:
`checkConfinement` cannot police an MCP tool — it carries no path Key Lime Pi resolved,
it executes inside a separate process the user configured, and its reach is
whatever that server exposes. Approval is the entire boundary.

**Namespaced tool names.** `mcp__<sourceId>__<toolName>`, sanitized to
`[A-Za-z0-9_-]` and capped at 64 characters. Without the namespace an MCP server
advertising `read` or `bash` would shadow a built-in. The prefix is also what the
permission gate keys on.

**Rebuild the session on change.** Pi fixes its tool list at session creation, and
`ExtensionAPI.registerTool` runs at extension-factory time. Rather than mutate a
live session, the source handlers call `disposeAgentHost()`; the next prompt
rebuilds against the same Pi session file, so the transcript survives.

## Findings from Pi 0.84.4

Read from the installed declarations, since the prose docs do not cover this.

**Pi accepts raw JSON Schema as `parameters`.** `validateToolArguments`
(`@earendil-works/pi-ai/dist/utils/validation.js:280`) checks for TypeBox's kind
symbol and falls back to plain JSON Schema coercion when it is absent. An MCP
`inputSchema` therefore passes straight through, cast `as unknown as TSchema`.
**Do not wrap it in `Type.Unsafe`** — that adds the brand and forces the TypeBox
path instead.

Verified against the real function: `required` is enforced, `enum` violations are
rejected, nested objects and arrays validate, and `"2"` is coerced to `2` for a
`number` property. The schema-compatibility risk this session was scoped around
turned out not to exist.

**MCP image content already matches Pi's.** Both are flat
`{ type: 'image', data, mimeType }`.

**`tools` is an allowlist covering custom tools.** Every qualified MCP name has to
be appended to it or Pi drops the tool silently.

## Implementation

### New: `apps/electron/src/main/agent/mcp-tools.ts`

Mirrors `version-tools.ts` in shape and in its never-throw convention.

| Export | Purpose |
|--------|---------|
| `MCP_TOOL_PREFIX` | `'mcp__'` — the marker the permission gate keys on |
| `qualifyMcpToolName` | Namespace, sanitize, and cap one tool name |
| `isMcpToolName` | Prefix test, used by `checkPermission` |
| `getMcpToolBindings` | Resolve connected sources to bindings, de-duplicating collisions after truncation |
| `createMcpTools` | Build one `defineTool()` per binding |
| `CallMcpTool` | Transport type, satisfied by `SourceManager.callTool` |

Result mapping: `text` and `image` blocks pass through, anything else
(`resource`, `audio`, future types) is serialized to text, and a server's
`isError: true` is prefixed with an error line. A rejected call becomes text too,
so the model can recover.

### Changed

| File | Change |
|------|--------|
| `agent/session.ts` | `mcpSources` param, `callMcpTool` callback, MCP names appended to the allowlist, MCP tools appended to `customTools` |
| `agent/permission-gate.ts` | Explicit `ask` branch for MCP names, above the `acceptEdits` block, so a later edit cannot grant them auto-approval by accident |
| `agent/system-prompt.ts` | Object parameter; a `## Connected Sources` section listing every bound tool by its exact callable name |
| `main/ipc.ts` | `initializeSources()`, host wiring, `disposeAgentHost()` on every source mutation, real validation on `sources:save` |
| `main/index.ts` | `void initializeSources()` on ready, off the first-paint path |

`sources:save` previously checked only that `config.id` was a string. Its payload
names a command Key Lime Pi will spawn *and* becomes part of the agent's tool surface,
so it is now validated in full: `type`, id charset, field lengths, argument count,
and a flat string env record.

Nothing in `packages/shared` or `packages/core` changed, and the renderer is
untouched — `SourcesPanel` already lists each source's tools, and approvals flow
through the existing `agent:tool-approval` channel.

## Verification

1. `bun run typecheck:all` and `bun run build`.
2. `ollama serve` with a tool-calling model selected in Settings.
3. Add a source in the Sources panel:
   `npx` / `-y @modelcontextprotocol/server-filesystem <scratch dir>`.
4. Restart — it should reconnect on its own. This is the check that `enabled` is
   read.
5. In `default` mode, ask the agent to use it. Expect an approval prompt naming
   `mcp__<source>__list_directory`, then a real result.
6. Deny once — the run continues with the denial as the tool result.
7. `plan` mode refuses the call as read-only.
8. `acceptEdits` **still** prompts. This is the security-relevant assertion.
9. Disconnect mid-session, prompt again — the tool is gone, the transcript resumes.
10. Point a source at a broken command: error in the panel, agent unaffected.
