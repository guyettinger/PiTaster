/**
 * Permission-related type definitions for anyapp.
 */

/**
 * Permission modes for tool execution.
 *
 * - `plan`: No side effects; reads and read-only network access only
 * - `default`: Prompt user for approval on each tool use
 * - `acceptEdits`: Auto-approve file operations
 * - `bypassPermissions`: Auto-approve all tool uses (use with caution)
 */
export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/**
 * Result of a permission check.
 */
export interface PermissionResult {
  /** Whether to allow the tool. */
  behavior: 'allow' | 'deny'
  /** Optional message explaining the decision. */
  message?: string
}

/**
 * Tool approval request sent to renderer.
 */
export interface ToolApprovalRequest {
  /** Unique ID for this request. */
  id: string
  /** Tool name. */
  tool: string
  /** Tool input parameters. */
  input: Record<string, unknown>
  /** Suggested action. */
  suggestion?: 'allow' | 'deny'
  /**
   * Advisory note about what the call does, shown alongside the prompt.
   *
   * Informational only — the request reached the user regardless. Used to say
   * that a shell command reaches the network, which the gate does not block.
   */
  notice?: string
}

/**
 * Tool approval response from renderer.
 */
export interface ToolApprovalResponse {
  /** Request ID being responded to. */
  id: string
  /** Whether approved. */
  approved: boolean
  /** Whether to remember this decision. */
  remember?: boolean
}
