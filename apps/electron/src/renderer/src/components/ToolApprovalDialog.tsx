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
      <div className="mx-4 max-w-lg rounded-lg bg-neutral-900 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-50">Tool Approval Required</h2>
        
        <p className="mt-2 text-neutral-400">
          The agent wants to use:{' '}
          <span className="font-mono text-blue-400">{request.tool}</span>
        </p>
        
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-neutral-800 p-3 text-sm text-neutral-100">
          {JSON.stringify(request.input, null, 2)}
        </pre>
        
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onDeny}
            className="rounded px-4 py-2 text-neutral-400 hover:bg-neutral-800"
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
