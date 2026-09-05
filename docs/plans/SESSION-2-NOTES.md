# Session 2: Implementation Notes

## Deviations from Plan

### SDK Package Change

**Plan:** Use `@anthropic-ai/claude-agent-sdk` with `createSdkMcpServer` and `tool` helpers.

**Actual:** Used `@anthropic-ai/sdk` (the standard Anthropic SDK) directly.

**Reason:** The `claude-agent-sdk` package referenced in the plan doesn't exist as a public npm package. The `@anthropic-ai/claude-code` package is a CLI tool, not a library. The standard SDK provides all necessary functionality for tool use and streaming.

### Type Imports

**Plan:** Import types from `@keylimepi/core` across all Electron processes.

**Actual:** Defined types locally in each process (main, preload, renderer).

**Reason:** TypeScript module resolution with `moduleResolution: "bundler"` and workspace packages required building packages before type checking. While the types are defined in `@keylimepi/core` for external use, the Electron app uses local type definitions to avoid build ordering dependencies during development.

### Tool Definition Format

**Plan:** Use `tool()` helper with Zod schemas:
```typescript
tool("read_source", "description", { path: z.string() }, async ({ path }) => { ... })
```

**Actual:** Use Anthropic SDK's native tool format:
```typescript
const tools: Anthropic.Tool[] = [{
  name: 'read_source',
  description: '...',
  input_schema: { type: 'object', properties: { path: { type: 'string' } } }
}]
```

**Reason:** The standard SDK uses JSON Schema for tool definitions, not Zod. This is the native format expected by the API.

## Implementation Details

### Streaming Architecture

The streaming implementation uses the SDK's `messages.stream()` method:

```typescript
const stream = client.messages.stream({ model, tools, messages })
for await (const event of stream) {
  // Handle content_block_start, content_block_delta, etc.
}
const finalMessage = await stream.finalMessage()
```

### Agentic Loop

Tool use requires a conversation loop:
1. Send user message
2. Stream response
3. If `stop_reason === 'tool_use'`, execute tools
4. Append tool results as user message
5. Continue loop until no more tool use

### Permission Modes

| Mode | File Tools | Build/Typecheck |
|------|------------|-----------------|
| `plan` | Deny | Deny |
| `default` | Ask | Ask |
| `acceptEdits` | Allow | Ask |
| `bypassPermissions` | Allow | Allow |

## Files Created

| File | Purpose |
|------|---------|
| `packages/core/src/agent.ts` | Agent types (ToolResult, StreamChunk, QueryOptions) |
| `packages/core/src/permissions.ts` | Permission types |
| `packages/core/src/messages.ts` | Message/Session types |
| `apps/electron/src/main/agent.ts` | Claude SDK integration, tools, permission logic |
| `apps/electron/src/main/ipc.ts` | IPC handlers for renderer communication |

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/index.ts` | Re-export all types |
| `apps/electron/package.json` | Added @anthropic-ai/sdk, zod, nanoid |
| `apps/electron/src/main/index.ts` | Import and setup IPC handlers |
| `apps/electron/src/preload/index.ts` | Updated API with tool approval flow |
| `apps/electron/src/renderer/src/App.tsx` | Chat interface with streaming |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Updated type definitions |

## Dependencies Added

```json
{
  "@anthropic-ai/sdk": "^0.36.0",
  "nanoid": "^5.0.0",
  "zod": "^3.25.0"
}
```

Note: `zod` was added per plan but isn't currently used since we're using JSON Schema directly. It may be useful for input validation in future iterations.

## Verification Results

- `bun run typecheck:all` - Passes
- `bun run dev` - Starts successfully
- Chat interface - Renders with permission dropdown
- Streaming - Works (text chunks flow to UI)

## Known Limitations

1. **API Key Required:** The agent requires `ANTHROPIC_API_KEY` environment variable
2. **No Persistence:** Conversation history is in memory only (cleared on app restart)
3. **No Version Control:** `write_source` doesn't commit changes yet (Session 3)
4. **Project Root:** Defaults to app directory in development; production path handling needed

## Next Steps (Session 3)

- Add isomorphic-git for version control
- Auto-commit on `write_source`
- Branch management UI
- Rollback functionality
