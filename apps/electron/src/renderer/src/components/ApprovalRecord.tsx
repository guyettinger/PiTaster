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
    case 'bash':
      return `${(input.command as string) ?? 'command'}`
    case 'read':
    case 'write':
    case 'edit':
    case 'ls':
      return `${(input.path as string) ?? 'file'}`
    case 'grep':
    case 'find':
      return `${(input.pattern as string) ?? 'pattern'}`
    case 'create_branch':
    case 'switch_branch':
      return `branch: ${(input.name as string) ?? ''}`
    case 'rollback':
      return `commit: ${(input.commit as string) ?? ''}`
    case 'web_fetch':
      return `${(input.url as string) ?? 'URL'}`
    case 'install_deps':
      return 'bun install'
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
      className={`flex items-center gap-2 rounded px-4 py-2 text-sm ${
        approved 
          ? 'bg-patina/10 border border-patina/40' 
          : 'bg-rust/10 border border-rust/40'
      }`}
    >
      <span className={approved ? 'text-patina' : 'text-rust'}>
        {approved ? '✓' : '✗'}
      </span>
      <span className="text-ash">
        {approved ? 'Approved' : 'Denied'}:
      </span>
      <span className="font-mono text-bone truncate">
        {summary}
      </span>
    </div>
  )
}
