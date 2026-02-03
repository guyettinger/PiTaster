/**
 * MCP Client for connecting to stdio-based MCP servers.
 */
import type { McpSourceConfig, McpTool } from '@clirabbit/core';
/**
 * Client for connecting to MCP (Model Context Protocol) servers via stdio.
 */
export declare class McpClient {
    private config;
    private client;
    private transport;
    /**
     * Creates an MCP client instance.
     * @param config - The MCP source configuration
     */
    constructor(config: McpSourceConfig);
    /**
     * Connect to the MCP server.
     * @returns The available tools from the server
     */
    connect(): Promise<McpTool[]>;
    /**
     * List available tools from the server.
     * @returns Array of tool definitions
     * @throws Error if not connected
     */
    listTools(): Promise<McpTool[]>;
    /**
     * Call a tool on the server.
     * @param name - The tool name to call
     * @param args - Arguments to pass to the tool
     * @returns The tool result
     * @throws Error if not connected
     */
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * Disconnect from the server.
     */
    disconnect(): Promise<void>;
    /**
     * Check if connected.
     * @returns True if connected to an MCP server
     */
    isConnected(): boolean;
}
//# sourceMappingURL=mcp-client.d.ts.map