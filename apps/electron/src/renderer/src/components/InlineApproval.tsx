/**
 * Inline tool approval request within chat.
 */

import { PatchList } from './DiffView'
import { WarningIcon } from './icons'
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
  const { tool, input, notice, patches } = request
  const mcp = parseMcpToolName(tool)

  // Get a user-friendly summary of what the tool wants to do
  const getSummary = (): string => {
    // MCP tools run inside a server Pi Taster does not control and are never
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
      case 'replace_lines':
        return `Replace lines ${(input.startLine as number) ?? '?'}-${(input.endLine as number) ?? '?'} in: ${(input.path as string) ?? 'file'}`
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
      case 'web_fetch':
        return `Fetch: ${(input.url as string) ?? 'URL'}`
      case 'install_deps':
        return 'Install dependencies (bun install)'
      case 'load_skill':
        return `Load skill: ${(input.name as string) ?? 'skill'}`
      default:
        return `Use ${tool}`
    }
  }
  
  return (
    <div className="rounded-lg border-2 border-keylime/40 bg-keylime/10 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <WarningIcon size={16} className="shrink-0 text-keylime" />
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
        <div className="mb-3 rounded border border-keylime/40 bg-panel/60 p-2">
          <p className="mb-1 text-xs font-medium text-keylime">
            Sends to an external MCP server:
          </p>
          <p className="font-mono text-xs break-all text-bone">
            {summarizeMcpInput(input)}
          </p>
        </div>
      )}

      {/*
        An advisory note from the gate — currently that a shell command reaches
        the network. The command was going to prompt anyway; this says why it is
        worth reading closely before approving.
      */}
      {notice && (
        <p className="mb-3 text-xs text-keylime">
          This command {notice}.
        </p>
      )}

      {/*
        What the write would actually do. This is the whole point of the prompt: without
        it the user is asked to take responsibility for a change they have been shown
        only the path of. Absent for `bash`, for MCP tools, and for an `edit` whose text
        could not be matched exactly — a preview here is approved on, so an inaccurate
        one would be worse than none.
      */}
      {patches && patches.length > 0 && (
        <div className="mb-3">
          <PatchList patches={patches} />
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
          className="flex-1 rounded-lg border border-line px-4 py-2 text-sm text-bone transition-colors hover:bg-raised"
        >
          Deny
        </button>
        <button
          onClick={onApprove}
          className="flex-1 rounded-lg bg-keylime px-4 py-2 text-sm font-medium text-ground transition-opacity hover:opacity-90"
        >
          Allow
        </button>
      </div>
    </div>
  )
}
