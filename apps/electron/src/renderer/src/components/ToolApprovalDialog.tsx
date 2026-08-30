/**
 * Tool approval dialog for permission requests.
 */

import type { ToolApprovalRequest } from '../types/electron'

/**
 * Props for the ToolApprovalDialog component.
 */
interface ToolApprovalDialogProps {
  /** The tool approval request to display. */
  request: ToolApprovalRequest
  /** Callback when user approves the tool. */
  onApprove: () => void
  /** Callback when user denies the tool. */
  onDeny: () => void
}

/**
 * Modal dialog for approving or denying tool usage.
 */
export function ToolApprovalDialog({ request, onApprove, onDeny }: ToolApprovalDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-w-lg rounded-lg bg-panel p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-bone">Tool Approval Required</h2>
        
        <p className="mt-2 text-ash">
          The agent wants to use:{' '}
          <span className="font-mono text-brass">{request.tool}</span>
        </p>
        
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-raised p-3 text-sm text-bone">
          {JSON.stringify(request.input, null, 2)}
        </pre>
        
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onDeny}
            className="rounded px-4 py-2 text-ash hover:bg-raised"
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            className="rounded bg-brass px-4 py-2 font-medium text-ground hover:opacity-90"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
