/**
 * What is actually in the context window, broken down into things worth doing about.
 *
 * The meter this feeds used to show one number and, for most of a session, nothing at
 * all: `agent:get-context-usage` answered off a lazily-created `agentHost`, so before
 * the first completed turn there was no host to ask, and `disposeAgentHost` — which
 * fires on an app switch, a session switch, and every skills, sources or config save —
 * took it back to nothing again.
 *
 * The fix is that **the fixed half of a request needs no session to measure.** The
 * system prompt, the tool schemas, Pi's restored tool guidance, the skill manifest and
 * the app's `AGENTS.md` are all pure functions of the app and its configuration, so a
 * report can be built cold — no `ModelRuntime`, no model warm, no TypeScript service.
 * That is the half the user can shrink by turning something off, and it is now visible
 * before a single prompt has been sent.
 *
 * **Blocks are estimates and the total is not.** Pi anchors `ContextUsage.tokens` to
 * the provider's own accounting for the last assistant message; everything here is the
 * chars/4 heuristic. The two will not agree. They are reported side by side rather than
 * scaled to match, because a breakdown that always sums to the measured total is a
 * breakdown that has been made up.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { estimateTokens as estimateMessageTokens } from '@earendil-works/pi-coding-agent'
import type { ContextEvent } from '@earendil-works/pi-coding-agent'
import { estimateTokens, renderSkillManifest } from '@anyapp/shared'
import type {
  ConnectedSource,
  ContextBlock,
  ContextHotspot,
  ContextReport,
  ContextReportState,
  Skill,
  SubApp
} from '@anyapp/core'
import type { ContextBudget } from './context-budget'
import { createCodeTools } from './code-tools'
import { createFileTools } from './file-tools'
import { createMcpTools, getMcpToolBindings } from './mcp-tools'
import { createSkillTools } from './skill-tools'
import { createVersionTools } from './version-tools'
import { createWebTools } from './web-tools'
import { loadSessionSkills } from './skills'
import { getSystemPrompt, renderMcpSection } from './system-prompt'
import { builtinDefinitions, renderToolGuidance } from './tool-guidance'

/** The message shape Pi hands its `context` hook, as `context-trim.ts` names it. */
type AgentMessage = ContextEvent['messages'][number]

/**
 * The context files Pi will find inside the app root.
 *
 * `confineContextFiles` is a *filter* over the list Pi assembles from its own ancestry
 * walk, so it cannot be asked what that list contains without a session. What survives
 * the filter is exactly the app root's own files, and these are the two names Pi looks
 * for — so reading them directly gives the same answer for the same reason the filter
 * exists.
 */
const CONTEXT_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md']

/** How many oversized tool results the report names individually. */
const HOTSPOT_LIMIT = 3

/**
 * A tool definition, reduced to the parts that ride in every request.
 *
 * Pi's `ToolDefinition` is generic in its schema type, so a heterogeneous array of them
 * cannot be held without a cast. Only these three fields are serialized into the
 * function-calling payload, and they are the only ones being measured.
 */
interface MeasurableTool {
  /** The tool's name. */
  name: string
  /** The description sent to the model. */
  description?: string
  /** The TypeBox schema, which is a plain JSON Schema object at runtime. */
  parameters?: unknown
}

/**
 * Parameters for {@link buildContextReport}.
 */
export interface BuildContextReportParams {
  /** The sub-app the session runs against. */
  app: SubApp
  /** The budget derived for the model this app will use. */
  budget: ContextBudget
  /** The base tool names the session enables, from `resolveToolNames`. */
  toolNames: string[]
  /** Which of those are Pi's own built-ins, whose guidance is restored separately. */
  builtinToolNames: string[]
  /** Connected MCP sources, whose tool schemas ride in every request. */
  mcpSources?: ConnectedSource[]
  /**
   * The live conversation, when a session exists.
   *
   * Absent means the report describes only what a session would start with — which is
   * a useful answer, not a missing one.
   */
  messages?: AgentMessage[]
  /** The provider's own token count for the conversation, when Pi has reported one. */
  measured?: number | null
}

/**
 * Size one tool the way the provider will: name, description and schema.
 *
 * @param tool - The definition to measure
 * @returns Estimated tokens the tool costs on every request
 */
function measureTool(tool: MeasurableTool): number {
  const schema = tool.parameters === undefined ? '' : JSON.stringify(tool.parameters)
  return estimateTokens(`${tool.name}${tool.description ?? ''}${schema}`)
}

/**
 * Build every tool definition a session would expose, without starting one.
 *
 * The factories take callbacks — a language-service `request`, an auto-commit getter, an
 * MCP dispatcher — because the tools *execute* through them. A schema does not, so they
 * are stubbed. Nothing here calls `execute`; acquiring a real TypeScript service to
 * measure a JSON schema would spend seconds of program build on a number.
 *
 * @param params - The app root, the enabled tool names and any connected sources
 * @returns The measurable definitions, filtered to what the session actually enables
 */
function collectTools(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** The base tool names the session enables. */
  toolNames: string[]
  /** The skills `load_skill` would offer. */
  skills: Skill[]
  /** Connected MCP sources. */
  mcpSources: ConnectedSource[]
}): { builtin: MeasurableTool[]; custom: MeasurableTool[]; mcp: MeasurableTool[] } {
  const { rootPath, toolNames, skills, mcpSources } = params
  const enabled = new Set(toolNames)

  const builtin = Object.entries(builtinDefinitions(rootPath))
    .filter(([name]) => enabled.has(name))
    .map(([name, definition]) => ({
      name,
      description: definition.description,
      parameters: definition.parameters
    }))

  const custom: MeasurableTool[] = [
    ...createFileTools({ rootPath }),
    ...createCodeTools({
      rootPath,
      request: () => Promise.reject(new Error('measurement only')),
      getAutoCommit: () => false
    }),
    ...createVersionTools(rootPath),
    ...createWebTools({ rootPath, getAutoCommit: () => false }),
    ...createSkillTools({ skills })
  ].filter((tool) => enabled.has(tool.name))

  const mcp = createMcpTools({
    bindings: getMcpToolBindings(mcpSources),
    callTool: () => Promise.reject(new Error('measurement only'))
  })

  return { builtin, custom, mcp }
}

/**
 * Read the app root's own context files.
 *
 * A missing file is the normal case, not an error: most templates ship without one.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The files that exist, with their contents
 */
async function readContextFiles(rootPath: string): Promise<{ name: string; text: string }[]> {
  const found: { name: string; text: string }[] = []

  for (const name of CONTEXT_FILE_NAMES) {
    try {
      found.push({ name, text: await readFile(join(rootPath, name), 'utf-8') })
    } catch {
      // Absent, unreadable, or a directory. Either way it contributes nothing.
    }
  }

  return found
}

/**
 * A message's content blocks, when it has any.
 * @param message - The message to inspect
 * @returns The blocks, or an empty array
 */
function contentBlocks(message: AgentMessage): unknown[] {
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : []
}

/**
 * Drop image blocks from a message entirely.
 *
 * Used to price images by *difference* rather than by restating Pi's own per-image
 * charge. Pi's estimator bills an image at a flat character count that anyapp has no
 * business knowing; subtracting the stripped estimate from the whole one recovers
 * exactly that charge, and keeps recovering it if Pi ever changes the number.
 *
 * `context-trim.ts` has a similarly-named helper that substitutes a *placeholder*,
 * because there the message still has to be sent. This one is for arithmetic.
 *
 * @param message - The message to strip
 * @returns The message, or a copy with image blocks removed
 */
function withoutImages(message: AgentMessage): AgentMessage {
  const blocks = contentBlocks(message)
  if (!blocks.some((block) => (block as { type?: unknown }).type === 'image')) return message

  const kept = blocks.filter((block) => (block as { type?: unknown }).type !== 'image')
  return { ...(message as object), content: kept } as AgentMessage
}

/**
 * Map every tool call id to a label naming what it did.
 *
 * A tool result carries its tool name but not its arguments — those live on the
 * assistant message that requested it — so naming `read src/App.tsx` rather than a bare
 * `read` means walking the calls first. This is the same correlation
 * `context-trim.ts` does to recognize superseded reads.
 *
 * @param messages - The conversation
 * @returns Tool call id to display label
 */
function collectCallLabels(messages: AgentMessage[]): Map<string, string> {
  const labels = new Map<string, string>()

  for (const message of messages) {
    if ((message as { role?: unknown }).role !== 'assistant') continue

    for (const block of contentBlocks(message)) {
      const call = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
      if (call.type !== 'toolCall' || typeof call.id !== 'string') continue

      const name = typeof call.name === 'string' ? call.name : 'tool'
      const args = call.arguments as { path?: unknown; url?: unknown } | undefined
      const subject =
        typeof args?.path === 'string' ? args.path : typeof args?.url === 'string' ? args.url : ''

      labels.set(call.id, subject.length > 0 ? `${name} ${subject}` : name)
    }
  }

  return labels
}

/** What one pass over the conversation yields. */
interface ConversationTally {
  /** Estimated tokens by block id. */
  totals: Map<string, number>
  /** Message counts by block id, for the legend's secondary text. */
  counts: Map<string, number>
  /** The largest individual tool results, descending. */
  hotspots: ContextHotspot[]
  /** How many images the conversation still carries. */
  images: number
}

/**
 * Attribute the conversation to blocks, in one pass.
 *
 * Buckets by role, with tool results kept apart because they are almost always the
 * largest bucket and the only one a user can do something about mid-task. Images are
 * separated out of whichever bucket carried them: a screenshot is worth more than a
 * thousand tokens and the trimmer drops old ones, so a user watching the number needs
 * to see them named.
 *
 * @param messages - The conversation
 * @returns The tallies, counts and hotspots
 */
function tallyConversation(messages: AgentMessage[]): ConversationTally {
  const totals = new Map<string, number>()
  const counts = new Map<string, number>()
  const labels = collectCallLabels(messages)
  const results: ContextHotspot[] = []
  let images = 0

  const add = (id: string, tokens: number): void => {
    totals.set(id, (totals.get(id) ?? 0) + tokens)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  for (const message of messages) {
    const role = (message as { role?: unknown }).role
    const whole = estimateMessageTokens(message)
    const stripped = estimateMessageTokens(withoutImages(message))
    const imageTokens = Math.max(0, whole - stripped)

    if (imageTokens > 0) {
      images += contentBlocks(message).filter(
        (block) => (block as { type?: unknown }).type === 'image'
      ).length
      totals.set('images', (totals.get('images') ?? 0) + imageTokens)
    }

    if (role === 'user') {
      add('user-messages', stripped)
    } else if (role === 'assistant') {
      add('assistant', stripped)
    } else if (role === 'toolResult') {
      add('tool-results', stripped)
      const callId = (message as { toolCallId?: unknown }).toolCallId
      const toolName = (message as { toolName?: unknown }).toolName
      const label =
        (typeof callId === 'string' ? labels.get(callId) : undefined) ??
        (typeof toolName === 'string' ? toolName : 'tool result')
      results.push({ label, tokens: stripped })
    } else {
      // System and custom entries — compaction summaries land here, and they are
      // history the user cannot clear without clearing the chat.
      add('other', stripped)
    }
  }

  counts.set('images', images)
  results.sort((left, right) => right.tokens - left.tokens)

  return { totals, counts, hotspots: results.slice(0, HOTSPOT_LIMIT), images }
}

/**
 * Add a block, unless it costs nothing.
 *
 * A zero block is noise in the legend and an invisible segment in the bar. The one
 * thing worth saying about something absent is said in another block's `detail`.
 *
 * @param blocks - The list being built
 * @param block - The candidate
 */
function push(blocks: ContextBlock[], block: ContextBlock): void {
  if (block.tokens > 0) blocks.push(block)
}

/**
 * Build the report for one app, with or without a live session.
 *
 * The returned `state` is never `stale` — only a caller serving a cached report knows
 * that, and it overrides the field.
 *
 * @param params - The app, its budget, its tool list and optionally its conversation
 * @returns What the context window holds
 */
export async function buildContextReport(
  params: BuildContextReportParams
): Promise<ContextReport> {
  const {
    app,
    budget,
    toolNames,
    builtinToolNames,
    mcpSources = [],
    messages,
    measured = null
  } = params

  const skills = await loadSessionSkills(app)
  const bindings = getMcpToolBindings(mcpSources)
  const contextFiles = await readContextFiles(app.path)
  const tools = collectTools({ rootPath: app.path, toolNames, skills, mcpSources })

  // The prompt inlines the manifest, the MCP section and Pi's tool guidance. Measuring
  // each separately and subtracting keeps the blocks additive — otherwise turning a
  // skill off would appear to shrink two blocks at once.
  const manifest = skills.length > 0 ? estimateTokens(renderSkillManifest(skills)) : 0
  const mcpSection = estimateTokens(renderMcpSection(bindings))
  const guidance = estimateTokens(
    renderToolGuidance({
      rootPath: app.path,
      toolNames: toolNames.filter((name) => builtinToolNames.includes(name))
    })
  )
  const wholePrompt = estimateTokens(
    getSystemPrompt({
      app,
      skills,
      mcpTools: bindings,
      toolNames: toolNames.filter((name) => builtinToolNames.includes(name))
    })
  )
  const basePrompt = Math.max(0, wholePrompt - manifest - mcpSection - guidance)

  const builtinCost = tools.builtin.reduce((sum, tool) => sum + measureTool(tool), 0)
  const customCost = tools.custom.reduce((sum, tool) => sum + measureTool(tool), 0)
  const mcpCost = tools.mcp.reduce((sum, tool) => sum + measureTool(tool), 0)
  const toolCount = tools.builtin.length + tools.custom.length

  const blocks: ContextBlock[] = []

  push(blocks, {
    id: 'tool-schemas',
    label: 'Tool schemas',
    group: 'fixed',
    tokens: builtinCost + customCost,
    detail: `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`
  })
  push(blocks, { id: 'system-prompt', label: 'System prompt', group: 'fixed', tokens: basePrompt })
  push(blocks, { id: 'tool-guidance', label: 'Tool guidance', group: 'fixed', tokens: guidance })
  push(blocks, {
    id: 'skill-manifest',
    label: 'Skill manifest',
    group: 'fixed',
    tokens: manifest,
    detail: `${skills.length} enabled`
  })
  push(blocks, {
    id: 'mcp-tools',
    label: 'Connected sources',
    group: 'fixed',
    tokens: mcpCost + mcpSection,
    detail: `${bindings.length} ${bindings.length === 1 ? 'tool' : 'tools'}`
  })
  push(blocks, {
    id: 'context-files',
    label: contextFiles.length === 1 ? contextFiles[0].name : 'Context files',
    group: 'fixed',
    tokens: contextFiles.reduce((sum, file) => sum + estimateTokens(file.text), 0),
    detail: contextFiles.length > 1 ? contextFiles.map((file) => file.name).join(', ') : undefined
  })

  const tally = messages ? tallyConversation(messages) : undefined

  if (tally) {
    const count = (id: string): string => {
      const value = tally.counts.get(id) ?? 0
      return `${value}`
    }

    push(blocks, {
      id: 'tool-results',
      label: 'Tool results',
      group: 'conversation',
      tokens: tally.totals.get('tool-results') ?? 0,
      detail: `${count('tool-results')} calls`
    })
    push(blocks, {
      id: 'assistant',
      label: 'Assistant replies',
      group: 'conversation',
      tokens: tally.totals.get('assistant') ?? 0,
      detail: count('assistant')
    })
    push(blocks, {
      id: 'user-messages',
      label: 'Your messages',
      group: 'conversation',
      tokens: tally.totals.get('user-messages') ?? 0,
      detail: count('user-messages')
    })
    push(blocks, {
      id: 'images',
      label: 'Screenshots',
      group: 'conversation',
      tokens: tally.totals.get('images') ?? 0,
      detail: count('images')
    })
    push(blocks, {
      id: 'other',
      label: 'Summaries',
      group: 'conversation',
      tokens: tally.totals.get('other') ?? 0
    })
  }

  blocks.sort((left, right) =>
    left.group === right.group
      ? right.tokens - left.tokens
      : left.group === 'fixed'
        ? -1
        : 1
  )

  const state: ContextReportState = !messages ? 'floor' : measured === null ? 'estimated' : 'live'

  return {
    state,
    measured,
    estimated: blocks.reduce((sum, block) => sum + block.tokens, 0),
    window: budget.window,
    windowSource: budget.source,
    compactAt: Math.max(0, budget.window - budget.compaction.reserveTokens),
    blocks,
    hotspots: tally?.hotspots ?? []
  }
}
