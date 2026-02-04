---
name: connect-source
description: Connect to external data sources including MCP servers, REST APIs, and local filesystems.
---

# Connecting Sources

Use this skill when you need to connect Anyapp to external data sources.

## MCP Servers

To connect an MCP server:

1. Identify the server command (e.g., `npx -y @modelcontextprotocol/server-github`)
2. Create source configuration with:
   - `type: 'mcp'`
   - `command`: the server command
   - `args`: command arguments array
   - `env`: optional environment variables
3. Connect using the Sources panel or programmatically
4. List available tools from the connected server

### Example MCP Configuration

```json
{
  "id": "github-server",
  "name": "GitHub MCP",
  "type": "mcp",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "..."
  }
}
```

## REST APIs

For REST API sources:

1. Get the base URL for the API
2. Determine authentication type:
   - API key (header or query param)
   - OAuth 2.0
   - Basic auth
3. Configure credentials securely
4. Test the connection with a simple request

## Local Filesystem

For filesystem access:

1. Specify the root path to watch
2. Set include patterns (e.g., `["**/*.ts", "**/*.tsx"]`)
3. Set exclude patterns (e.g., `["node_modules/**", "dist/**"]`)
4. Test file listing works correctly

## Best Practices

- Always test connections before relying on them
- Store sensitive credentials in the config file, not in code
- Use environment variables for secrets when possible
- Disconnect sources when not in use to free resources
