---
name: agent-sdk
description: Reference for the Claude Agent SDK (createSdkMcpServer, canUseTool, streaming) as a possible future replacement for anyapp's hand-rolled agent loop. Use when evaluating or planning that migration.
---

# Claude Agent SDK — Migration Reference

> **This describes code that does not exist yet.** anyapp currently talks to the
> Anthropic Messages API directly: `@anthropic-ai/sdk` with ~25 hand-rolled tool
> definitions, a custom permission gate, and manual stream handling in
> `apps/electron/src/main/agent.ts`. `@anthropic-ai/claude-agent-sdk` is **not**
> a dependency. Everything below is the target shape if that migration is taken
> on — not a description of the current codebase.

## Why It Would Matter Here

The SDK natively provides three things anyapp currently hand-rolls:

| anyapp today | SDK equivalent |
|---|---|
| 25 tool schemas + a `switch` in `executeTool` | `createSdkMcpServer` with Zod-typed `tool()` helpers |
| Custom `getPermissionBehavior` classification lists | `canUseTool` callback + native `permissionMode` |
| Manual `content_block_delta` accumulation | `includePartialMessages` stream events |

## Creating Custom Tools

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool(
      "read_file",
      "Read contents of a file",
      { path: z.string().describe("File path to read") },
      async ({ path }) => {
        const content = await fs.readFile(path, 'utf-8')
        return { content: [{ type: "text", text: content }] }
      }
    )
  ]
})
```

## Permission Modes

The SDK's modes line up with anyapp's existing `PermissionMode` type, which is
what makes this migration plausible without changing the UI:

| Mode | Behavior |
|------|----------|
| `default` | Triggers the `canUseTool` callback for approval |
| `acceptEdits` | Auto-approves file edits |
| `bypassPermissions` | Auto-approves ALL tools (use with caution) |
| `plan` | Read-only, no tool execution |

## Implementing CanUseTool

```typescript
const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
  if (permissionMode === 'plan') {
    return { behavior: 'deny', message: 'Plan mode active' }
  }
  if (permissionMode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }
  const approved = await showApprovalDialog(toolName, input)
  return approved ? { behavior: 'allow' } : { behavior: 'deny' }
}
```

## Streaming Responses

```typescript
for await (const message of query({
  prompt,
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    const event = message.event

    if (event.type === "content_block_delta" &&
        event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text)
    }

    if (event.type === "content_block_start" &&
        event.content_block.type === "tool_use") {
      console.log(`[Using ${event.content_block.name}...]`)
    }

    if (event.type === "content_block_stop") {
      console.log(" done")
    }
  }
}
```

## Tool Input Streaming

Accumulate tool arguments as they arrive:

```typescript
let toolInput = ""

if (event.type === "content_block_delta" &&
    event.delta.type === "input_json_delta") {
  toolInput += event.delta.partial_json
}
```

## Before Migrating

Check the current SDK docs first — this file is a sketch, and the API has moved.
Also note the app pins an old `@anthropic-ai/sdk` and hardcodes its model ID in
`apps/electron/src/main/agent.ts`; both should be addressed in the same pass.
