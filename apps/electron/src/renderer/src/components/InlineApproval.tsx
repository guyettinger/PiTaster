/**
 * Inline tool approval request within chat.
 */

import type { ToolApprovalRequest } from '../types/electron'

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
  // Get a user-friendly summary of what the tool wants to do
  const getSummary = (): string => {
    const { tool, input } = request
    
    switch (tool) {
      case 'run_command':
        return `Run: ${(input.command as string) ?? 'command'}`
      case 'write_file':
        return `Write to: ${(input.path as string) ?? 'file'}`
      case 'delete_file':
        return `Delete: ${(input.path as string) ?? 'file'}`
      case 'create_directory':
        return `Create folder: ${(input.path as string) ?? 'directory'}`
      case 'create_branch':
        return `Create branch: ${(input.name as string) ?? 'branch'}`
      case 'switch_branch':
        return `Switch to branch: ${(input.name as string) ?? 'branch'}`
      case 'rollback':
        return `Rollback to: ${(input.commit as string) ?? 'commit'}`
      default:
        return `Use ${tool}`
    }
  }
  
  return (
    <div className="my-3 rounded-lg border-2 border-yellow-600 bg-yellow-900/20 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚠️</span>
        <span className="font-medium text-yellow-200">Approval Required</span>
      </div>
      
      {/* Tool summary */}
      <p className="text-sm text-neutral-300 mb-3">
        {getSummary()}
      </p>
      
      {/* Input details (collapsed by default for non-sensitive tools) */}
      <details className="mb-3">
        <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-200">
          View full input
        </summary>
        <pre className="mt-2 rounded bg-neutral-900 p-2 text-xs text-neutral-300 overflow-auto max-h-40">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </details>
      
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onDeny}
          className="flex-1 rounded border border-neutral-600 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={onApprove}
          className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors"
        >
          Allow
        </button>
      </div>
    </div>
  )
}
