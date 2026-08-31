/**
 * Inline bubble for displaying tool usage in chat.
 */

import { useState } from 'react'
import {
  FileIcon,
  FileEditIcon,
  FolderIcon,
  CommandIcon,
  SearchIcon,
  BranchIcon,
  HistoryIcon,
  SourceIcon,
  GlobeIcon,
  PlusIcon,
  ToolIcon
} from './icons'
import { isMcpToolName, parseMcpToolName, summarizeMcpInput } from '../lib/mcpToolDisplay'
import type { ComponentType } from 'react'
import type { IconProps } from './icons'

/**
 * Props for the ToolBubble component.
 */
interface ToolBubbleProps {
  /** Tool name. */
  tool: string
  /** Tool status. */
  status: 'pending' | 'running' | 'complete' | 'error' | 'approved' | 'denied'
  /** Tool input parameters. */
  input?: Record<string, unknown>
  /** Tool output/result summary. */
  output?: string
  /** Error message if failed. */
  error?: string
}

/**
 * How a tool is presented in the transcript.
 */
interface ToolDisplay {
  /** The glyph for this tool. */
  Icon: ComponentType<IconProps>
  /** The tool's name, as a person would say it. */
  label: string
}

/** Every built-in tool Pi exposes, plus anyapp's own version-control and network tools. */
const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  bash: { Icon: CommandIcon, label: 'Command' },
  read: { Icon: FileIcon, label: 'Read file' },
  write: { Icon: FileEditIcon, label: 'Write file' },
  edit: { Icon: FileEditIcon, label: 'Edit file' },
  replace_lines: { Icon: FileEditIcon, label: 'Replace lines' },
  ls: { Icon: FolderIcon, label: 'List files' },
  find: { Icon: SearchIcon, label: 'Find files' },
  grep: { Icon: SearchIcon, label: 'Search' },
  create_branch: { Icon: BranchIcon, label: 'Create branch' },
  switch_branch: { Icon: BranchIcon, label: 'Switch branch' },
  list_branches: { Icon: BranchIcon, label: 'List branches' },
  get_history: { Icon: HistoryIcon, label: 'History' },
  rollback: { Icon: HistoryIcon, label: 'Roll back' },
  git_status: { Icon: HistoryIcon, label: 'Git status' },
  web_fetch: { Icon: GlobeIcon, label: 'Fetch URL' },
  install_deps: { Icon: PlusIcon, label: 'Install dependencies' }
}

/**
 * Returns how to present a tool call.
 *
 * @param tool - The tool name as the agent reported it
 * @returns The glyph and label to show
 */
function getToolDisplay(tool: string): ToolDisplay {
  // MCP tools are named per connected source, so they cannot be enumerated
  // above. Label them by server and tool rather than by the raw qualified name.
  const mcp = parseMcpToolName(tool)
  if (mcp) {
    return { Icon: SourceIcon, label: `${mcp.sourceId} → ${mcp.toolName}` }
  }

  return TOOL_DISPLAY[tool] ?? { Icon: ToolIcon, label: tool }
}

/**
 * Returns status styling for a tool bubble.
 */
function getStatusStyle(status: ToolBubbleProps['status']): string {
  switch (status) {
    // Only states that want something from you are tinted. "Complete" is the
    // common case, so it stays neutral — otherwise a long transcript becomes a
    // wall of colored panels and the tint stops meaning anything.
    case 'pending':
    case 'running':
      return 'border-brass/40 bg-brass/10'
    case 'error':
    case 'denied':
      return 'border-rust/40 bg-rust/10'
    default:
      return 'border-line bg-panel'
  }
}

/**
 * Extracts a summary from tool input for display.
 */
function getInputSummary(tool: string, input?: Record<string, unknown>): string | null {
  if (!input) return null

  // An MCP tool's arguments are the payload leaving the machine; show them rather
  // than returning null and rendering the call as an opaque row.
  if (isMcpToolName(tool)) {
    return summarizeMcpInput(input)
  }

  switch (tool) {
    case 'bash':
      return (input.command as string) ?? null
    case 'read':
    case 'write':
    case 'edit':
    case 'ls':
      return (input.path as string) ?? null
    case 'replace_lines':
      return input.path
        ? `${input.path as string}:${input.startLine as number}-${input.endLine as number}`
        : null
    case 'grep':
    case 'find':
      return (input.pattern as string) ?? null
    case 'create_branch':
    case 'switch_branch':
      return (input.name as string) ?? null
    case 'rollback':
      return (input.commit as string) ?? null
    case 'web_fetch':
      return (input.url as string) ?? null
    default:
      return null
  }
}

/**
 * Renders inline tool usage bubble.
 */
export function ToolBubble({ tool, status, input, output, error }: ToolBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { Icon: ToolGlyph, label } = getToolDisplay(tool)
  const summary = getInputSummary(tool, input)
  
  return (
    <div 
      className={`rounded-lg border px-4 py-2 ${getStatusStyle(status)}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-ash">
            <ToolGlyph size={15} />
          </span>
          <span className="text-sm font-medium text-bone">{label}</span>
          {status === 'running' && (
            <span className="animate-pulse text-xs text-brass">Running…</span>
          )}
          {status === 'approved' && (
            <span className="text-xs text-patina">Approved</span>
          )}
          {status === 'denied' && (
            <span className="text-xs text-rust">Denied</span>
          )}
          {status === 'complete' && (
            <span className="text-xs text-ash">Complete</span>
          )}
        </div>
        
        {/* Expand toggle for details */}
        {(input || output) && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="-mr-2 rounded px-2 py-1 text-xs text-ash transition-colors hover:bg-raised hover:text-bone"
          >
            {isExpanded ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      
      {/* Summary line */}
      {summary && (
        <div className="mt-1 font-mono text-xs text-ash truncate">
          {summary}
        </div>
      )}
      
      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {input && (
            <div className="rounded bg-panel p-2">
              <div className="text-xs font-medium text-ash mb-1">Input</div>
              <pre className="text-xs text-bone overflow-auto max-h-32">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output && (
            <div className="rounded bg-panel p-2">
              <div className="text-xs font-medium text-ash mb-1">Output</div>
              <pre className="text-xs text-bone overflow-auto max-h-32 whitespace-pre-wrap">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="mt-2 text-xs text-rust">
          Error: {error}
        </div>
      )}
    </div>
  )
}
