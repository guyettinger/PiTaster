---
paths:
  - "packages/shared/src/sources/**/*.ts"
---

# MCP TypeScript SDK

Sources are external MCP servers the agent can connect to. Client and manager
live in `packages/shared/src/sources/`.

## Version Requirements

Use v1.x (stable). v2 is pre-alpha and not production ready.

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.0",
    "zod": "^3.25.0"
  }
}
```

## Import Paths

Always use specific import paths with the `.js` extension:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
```

## Creating an MCP Client (Stdio)

```typescript
const client = new Client({
  name: 'anyapp-client',
  version: '1.0.0'
})

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github']
})

await client.connect(transport)

const result = await client.callTool({
  name: 'list_repos',
  arguments: { owner: 'anthropics' }
})

// ALWAYS clean up
await client.close()
```

## Creating an MCP Server

```typescript
import * as z from 'zod'

const server = new McpServer({
  name: 'my-server',
  version: '1.0.0'
})

server.registerTool(
  'get_time',
  {
    title: 'Get Current Time',
    description: 'Returns current timestamp',
    inputSchema: {},
    outputSchema: {
      timestamp: z.string(),
      timezone: z.string()
    }
  },
  async () => {
    const output = {
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

## Error Handling

Connections are user-configured and routinely fail. Always close the client:

```typescript
try {
  await client.connect(transport)
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('MCP server command not found')
  }
  throw error
} finally {
  await client.close()
}
```
