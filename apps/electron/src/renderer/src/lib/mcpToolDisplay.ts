/**
 * Display helpers for tools contributed by connected MCP sources.
 *
 * MCP tools are the one part of the agent's surface that path confinement cannot
 * police — they run inside a separate server process the user configured, and user
 * approval is the whole boundary. A boundary the user cannot read is not a
 * boundary, so these helpers exist to make an `mcp__source__tool` call legible at a
 * glance: which server it goes to, which tool, and what is actually being sent.
 *
 * The main process builds these names in
 * `apps/electron/src/main/agent/mcp-tools.ts`; the two must stay in step.
 */

/** Prefix marking a tool as belonging to an MCP source. */
export const MCP_TOOL_PREFIX = 'mcp__'

/** Maximum characters of a single argument value shown in a summary. */
const MAX_VALUE_CHARS = 120

/** Maximum number of arguments named in a summary. */
const MAX_SUMMARY_ARGS = 3

/**
 * One MCP tool name, split back into its parts.
 */
export interface ParsedMcpToolName {
  /** ID of the source the tool belongs to. */
  sourceId: string
  /** The tool's own name on that server. */
  toolName: string
}

/**
 * Test whether a tool name came from an MCP source.
 * @param tool - The tool name
 * @returns True when the tool is an MCP bridge tool
 */
export function isMcpToolName(tool: string): boolean {
  return tool.startsWith(MCP_TOOL_PREFIX)
}

/**
 * Split `mcp__<sourceId>__<toolName>` back into its parts.
 *
 * Source IDs cannot contain `__` (they are validated to `[a-z0-9-]+` before being
 * saved), so the first separator after the prefix is the right split point.
 *
 * @param tool - The qualified tool name
 * @returns The parts, or null when the name is not an MCP tool name
 */
export function parseMcpToolName(tool: string): ParsedMcpToolName | null {
  if (!isMcpToolName(tool)) return null

  const rest = tool.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  if (separator === -1) return { sourceId: rest, toolName: rest }

  return {
    sourceId: rest.slice(0, separator),
    toolName: rest.slice(separator + 2)
  }
}

/**
 * Render one argument value as a single short line.
 * @param value - The value the model supplied
 * @returns A truncated, single-line rendering
 */
function renderValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const flat = (text ?? String(value)).replace(/\s+/g, ' ').trim()
  return flat.length > MAX_VALUE_CHARS ? `${flat.slice(0, MAX_VALUE_CHARS)}…` : flat
}

/**
 * Summarize an MCP tool's arguments for display next to the approval prompt.
 *
 * Every argument name is shown, so a reviewer can see that a tool is being handed
 * something it has no business receiving — the tell for a prompt-injected
 * exfiltration attempt. Values are truncated, never hidden.
 *
 * @param input - The arguments the model supplied
 * @returns A one-line summary, or null when there are no arguments
 */
export function summarizeMcpInput(input?: Record<string, unknown>): string | null {
  if (!input) return null

  const entries = Object.entries(input)
  if (entries.length === 0) return null

  const shown = entries
    .slice(0, MAX_SUMMARY_ARGS)
    .map(([key, value]) => `${key}: ${renderValue(value)}`)
    .join(', ')

  const hidden = entries.length - MAX_SUMMARY_ARGS
  return hidden > 0 ? `${shown}, +${hidden} more` : shown
}
