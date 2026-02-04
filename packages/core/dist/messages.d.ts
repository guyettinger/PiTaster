/**
 * Message-related type definitions for anyapp.
 */
import type { ToolResult } from './agent';
/**
 * A chat message in a session.
 */
export interface Message {
    /** Unique message ID. */
    id: string;
    /** Message role. */
    role: 'user' | 'assistant';
    /** Message content. */
    content: string;
    /** ISO timestamp. */
    timestamp: string;
    /** Tools used in this message (assistant only). */
    tools?: ToolResult[];
}
/**
 * A chat session.
 */
export interface Session {
    /** Unique session ID. */
    id: string;
    /** Session title. */
    title: string;
    /** Workspace ID this session belongs to. */
    workspaceId: string;
    /** ISO timestamp when created. */
    createdAt: string;
    /** ISO timestamp when last updated. */
    updatedAt: string;
}
//# sourceMappingURL=messages.d.ts.map