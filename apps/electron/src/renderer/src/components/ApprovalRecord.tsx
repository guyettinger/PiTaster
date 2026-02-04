/**
 * Record of a completed tool approval decision.
 */

/**
 * Props for the ApprovalRecord component.
 */
interface ApprovalRecordProps {
  /** Tool name. */
  tool: string
  /** Tool input. */
  input: Record<string, unknown>
  /** Whether it was approved. */
  approved: boolean
  /** Timestamp of decision. */
  timestamp?: string
}

/**
 * Gets a summary of the tool action for display.
 */
function getSummary(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'run_command':
      return `${(input.command as string) ?? 'command'}`
    case 'write_file':
      return `${(input.path as string) ?? 'file'}`
    case 'delete_file':
      return `${(input.path as string) ?? 'file'}`
    case 'create_branch':
      return `branch: ${(input.name as string) ?? ''}`
    case 'switch_branch':
      return `branch: ${(input.name as string) ?? ''}`
    case 'rollback':
      return `commit: ${(input.commit as string) ?? ''}`
    default:
      return tool
  }
}

/**
 * Compact inline record of an approval decision.
 */
export function ApprovalRecord({ tool, input, approved }: ApprovalRecordProps) {
  const summary = getSummary(tool, input)
  
  return (
    <div 
      className={`my-2 flex items-center gap-2 rounded px-3 py-2 text-sm ${
        approved 
          ? 'bg-green-900/30 border border-green-800' 
          : 'bg-red-900/30 border border-red-800'
      }`}
    >
      <span className={approved ? 'text-green-400' : 'text-red-400'}>
        {approved ? '✓' : '✗'}
      </span>
      <span className="text-neutral-400">
        {approved ? 'Approved' : 'Denied'}:
      </span>
      <span className="font-mono text-neutral-200 truncate">
        {summary}
      </span>
    </div>
  )
}
