/**
 * Inline bubble for displaying tool usage in chat.
 */

import { useState } from 'react'

/**
 * Props for the ToolBubble component.
 */
interface ToolBubbleProps {
  /** Tool name. */
  tool: string
  /** Tool status. */
  status: 'pending' | 'running' | 'complete' | 'approved' | 'denied'
  /** Tool input parameters. */
  input?: Record<string, unknown>
  /** Tool output/result summary. */
  output?: string
  /** Error message if failed. */
  error?: string
}

/**
 * Returns a user-friendly label for a tool name.
 */
function getToolLabel(tool: string): { icon: string; label: string } {
  const toolMap: Record<string, { icon: string; label: string }> = {
    run_command: { icon: '⌘', label: 'Command' },
    read_file: { icon: '📄', label: 'Read File' },
    write_file: { icon: '✏️', label: 'Write File' },
    list_files: { icon: '📁', label: 'List Files' },
    create_directory: { icon: '📂', label: 'Create Directory' },
    delete_file: { icon: '🗑️', label: 'Delete File' },
    search_files: { icon: '🔍', label: 'Search' },
    create_branch: { icon: '🌿', label: 'Create Branch' },
    switch_branch: { icon: '🔀', label: 'Switch Branch' },
    list_branches: { icon: '🌳', label: 'List Branches' },
    get_history: { icon: '📜', label: 'History' },
    rollback: { icon: '⏪', label: 'Rollback' },
    git_status: { icon: '📊', label: 'Git Status' },
    default: { icon: '🔧', label: tool }
  }
  return toolMap[tool] ?? toolMap.default
}

/**
 * Returns status styling for a tool bubble.
 */
function getStatusStyle(status: ToolBubbleProps['status']): string {
  switch (status) {
    case 'pending':
      return 'border-yellow-600 bg-yellow-900/20'
    case 'running':
      return 'border-blue-600 bg-blue-900/20 animate-pulse'
    case 'complete':
      return 'border-green-600 bg-green-900/20'
    case 'approved':
      return 'border-green-600 bg-green-900/30'
    case 'denied':
      return 'border-red-600 bg-red-900/20'
    default:
      return 'border-neutral-600 bg-neutral-800'
  }
}

/**
 * Extracts a summary from tool input for display.
 */
function getInputSummary(tool: string, input?: Record<string, unknown>): string | null {
  if (!input) return null
  
  switch (tool) {
    case 'run_command':
      return (input.command as string) ?? null
    case 'read_file':
    case 'write_file':
    case 'delete_file':
      return (input.path as string) ?? null
    case 'list_files':
      return (input.directory as string) ?? (input.path as string) ?? null
    case 'search_files':
      return (input.pattern as string) ?? (input.query as string) ?? null
    case 'create_branch':
    case 'switch_branch':
      return (input.name as string) ?? null
    case 'rollback':
      return (input.commit as string) ?? null
    default:
      return null
  }
}

/**
 * Renders inline tool usage bubble.
 */
export function ToolBubble({ tool, status, input, output, error }: ToolBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { icon, label } = getToolLabel(tool)
  const summary = getInputSummary(tool, input)
  
  return (
    <div 
      className={`my-2 rounded-lg border px-3 py-2 ${getStatusStyle(status)}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-medium text-neutral-200">{label}</span>
          {status === 'running' && (
            <span className="text-xs text-blue-400">Running...</span>
          )}
          {status === 'approved' && (
            <span className="text-xs text-green-400">✓ Approved</span>
          )}
          {status === 'denied' && (
            <span className="text-xs text-red-400">✗ Denied</span>
          )}
          {status === 'complete' && (
            <span className="text-xs text-green-400">✓ Complete</span>
          )}
        </div>
        
        {/* Expand toggle for details */}
        {(input || output) && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {isExpanded ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      
      {/* Summary line */}
      {summary && (
        <div className="mt-1 font-mono text-xs text-neutral-400 truncate">
          {summary}
        </div>
      )}
      
      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {input && (
            <div className="rounded bg-neutral-900 p-2">
              <div className="text-xs font-medium text-neutral-500 mb-1">Input</div>
              <pre className="text-xs text-neutral-300 overflow-auto max-h-32">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output && (
            <div className="rounded bg-neutral-900 p-2">
              <div className="text-xs font-medium text-neutral-500 mb-1">Output</div>
              <pre className="text-xs text-neutral-300 overflow-auto max-h-32 whitespace-pre-wrap">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="mt-2 text-xs text-red-400">
          Error: {error}
        </div>
      )}
    </div>
  )
}
