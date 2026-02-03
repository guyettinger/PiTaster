/**
 * MCP Client for connecting to stdio-based MCP servers.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
/**
 * Environment variables to filter out when spawning MCP servers.
 * These should never be passed to external processes.
 */
const BLOCKED_ENV_VARS = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'OPENAI_ORG_ID',
    'CLAUDE_API_KEY'
];
/**
 * Client for connecting to MCP (Model Context Protocol) servers via stdio.
 */
export class McpClient {
    config;
    client = null;
    transport = null;
    /**
     * Creates an MCP client instance.
     * @param config - The MCP source configuration
     */
    constructor(config) {
        this.config = config;
    }
    /**
     * Connect to the MCP server.
     * @returns The available tools from the server
     */
    async connect() {
        // Filter environment variables to remove sensitive keys
        const filteredEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !BLOCKED_ENV_VARS.includes(key)));
        // Merge with source-specific env
        const env = { ...filteredEnv, ...this.config.env };
        // Create client
        this.client = new Client({
            name: `clirabbit-${this.config.id}`,
            version: '1.0.0'
        });
        // Create transport
        this.transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env
        });
        // Connect
        await this.client.connect(this.transport);
        // List available tools
        const tools = await this.listTools();
        return tools;
    }
    /**
     * List available tools from the server.
     * @returns Array of tool definitions
     * @throws Error if not connected
     */
    async listTools() {
        if (!this.client) {
            throw new Error('Not connected');
        }
        const result = await this.client.listTools();
        return result.tools.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema
        }));
    }
    /**
     * Call a tool on the server.
     * @param name - The tool name to call
     * @param args - Arguments to pass to the tool
     * @returns The tool result
     * @throws Error if not connected
     */
    async callTool(name, args) {
        if (!this.client) {
            throw new Error('Not connected');
        }
        const result = await this.client.callTool({ name, arguments: args });
        return result;
    }
    /**
     * Disconnect from the server.
     */
    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.transport = null;
        }
    }
    /**
     * Check if connected.
     * @returns True if connected to an MCP server
     */
    isConnected() {
        return this.client !== null;
    }
}
