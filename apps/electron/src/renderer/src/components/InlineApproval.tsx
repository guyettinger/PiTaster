/**
 * Inline tool approval request within chat.
 */

import type { ToolApprovalRequest } from '../types/electron'
import { isMcpToolName, parseMcpToolName, summarizeMcpInput } from '../lib/mcpToolDisplay'

/**
 * Props for the InlineApproval component.
 */
interface InlineApprovalProps {
  /** The approval request. */
  request: ToolApprovalRequest
  /** Callback when user approves. */
  onApprove: () => void
  /** Callback when user denies. */
  onDeny: () => void
}

/**
 * Inline approval bubble that appears in the chat flow.
 */
export function InlineApproval({ request, onApprove, onDeny }: InlineApprovalProps) {
  const { tool, input } = request
  const mcp = parseMcpToolName(tool)

  // Get a user-friendly summary of what the tool wants to do
  const getSummary = (): string => {
    // MCP tools run inside a server anyapp does not control and are never
    // auto-approved, so this prompt is the only boundary. Name the server and the
    // tool rather than falling through to a bare `Use mcp__x__y`.
    if (mcp) {
      return `${mcp.sourceId} → ${mcp.toolName}`
    }

    switch (tool) {
      case 'bash':
        return `Run: ${(input.command as string) ?? 'command'}`
      case 'read':
        return `Read: ${(input.path as string) ?? 'file'}`
      case 'write':
        return `Write to: ${(input.path as string) ?? 'file'}`
      case 'edit':
        return `Edit: ${(input.path as string) ?? 'file'}`
      case 'ls':
        return `List: ${(input.path as string) ?? '.'}`
      case 'grep':
        return `Search for: ${(input.pattern as string) ?? 'pattern'}`
      case 'find':
        return `Find files: ${(input.pattern as string) ?? 'pattern'}`
      case 'create_branch':
        return `Create branch: ${(input.name as string) ?? 'branch'}`
      case 'switch_branch':
        return `Switch to branch: ${(input.name as string) ?? 'branch'}`
      case 'list_branches':
        return 'List branches'
      case 'get_history':
        return 'View commit history'
      case 'git_status':
        return 'Check git status'
      case 'rollback':
        return `Rollback to: ${(input.commit as string) ?? 'commit'}`
      default:
        return `Use ${tool}`
    }
  }
  
  return (
    <div className="my-3 rounded-lg border-2 border-brass/40 bg-brass/10 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚠️</span>
        <span className="font-medium text-bone">Approval Required</span>
      </div>
      
      {/* Tool summary */}
      <p className="text-sm text-bone mb-3">
        {getSummary()}
      </p>

      {/*
        For an MCP tool the arguments are the payload leaving the machine, so they
        are shown inline rather than behind the disclosure below. A tool being
        handed something it has no business receiving is the tell for a
        prompt-injected exfiltration attempt, and it has to be visible to catch.
      */}
      {mcp && summarizeMcpInput(input) && (
        <div className="mb-3 rounded border border-brass/40 bg-panel/60 p-2">
          <p className="mb-1 text-xs font-medium text-brass">
            Sends to an external MCP server:
          </p>
          <p className="font-mono text-xs break-all text-bone">
            {summarizeMcpInput(input)}
          </p>
        </div>
      )}

      {/* Input details (collapsed by default for non-sensitive tools) */}
      <details className="mb-3">
        <summary className="text-xs text-ash cursor-pointer hover:text-bone">
          View full input
        </summary>
        <pre className="mt-2 rounded bg-panel p-2 text-xs text-bone overflow-auto max-h-40">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </details>
      
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onDeny}
          className="flex-1 rounded border border-line px-3 py-2 text-sm text-bone hover:bg-raised transition-colors"
        >
          Deny
        </button>
        <button
          onClick={onApprove}
          className="flex-1 rounded bg-brass px-3 py-2 text-sm font-medium text-ground transition-opacity hover:opacity-90"
        >
          Allow
        </button>
      </div>
    </div>
  )
}
