/**
 * Source Manager for managing external source connections.
 */
import type { AnySourceConfig, ConnectedSource } from '@anyapp/core';
/**
 * Manages source configurations and connections.
 */
export declare class SourceManager {
    private configDir;
    private sources;
    private mcpClients;
    /**
     * Creates a SourceManager instance.
     * @param configDir - The configuration directory (e.g., ~/.anyapp)
     */
    constructor(configDir: string);
    /**
     * Load all source configurations from disk.
     * @returns Array of source configurations
     */
    loadSources(): Promise<AnySourceConfig[]>;
    /**
     * Save a source configuration to disk.
     * @param config - The source configuration to save
     */
    saveSource(config: AnySourceConfig): Promise<void>;
    /**
     * Delete a source configuration from disk.
     * @param id - The source ID to delete
     */
    deleteSource(id: string): Promise<void>;
    /**
     * Connect to a source.
     * @param config - The source configuration
     * @returns The connected source state
     */
    connect(config: AnySourceConfig): Promise<ConnectedSource>;
    /**
     * Disconnect from a source.
     * @param sourceId - The source ID to disconnect
     */
    disconnect(sourceId: string): Promise<void>;
    /**
     * Call a tool on a connected source.
     * @param sourceId - The source ID
     * @param toolName - The tool name to call
     * @param args - Arguments to pass to the tool
     * @returns The tool result
     * @throws Error if source not connected
     */
    callTool(sourceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * Get all sources with their connection state.
     * @returns Array of connected source states
     */
    getConnectedSources(): ConnectedSource[];
    /**
     * Get a specific source by ID.
     * @param id - The source ID
     * @returns The connected source or undefined
     */
    getSource(id: string): ConnectedSource | undefined;
    /**
     * Disconnect all sources.
     */
    disconnectAll(): Promise<void>;
}
//# sourceMappingURL=manager.d.ts.map