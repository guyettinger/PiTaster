/**
 * Tests for the context report.
 *
 * Two of these guard properties that are easy to lose and impossible to notice:
 * additivity, because the system prompt inlines the skill manifest and the tool
 * guidance and measuring both the whole and the parts would double-charge the user for
 * every skill they enable; and the fixed floor, because a report that needs a live
 * session is the bug this module was written to fix.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextEvent } from '@earendil-works/pi-coding-agent'
import type { SubApp } from '@pitaster/core'
import { buildContextReport } from './context-report'
import { deriveContextBudget } from './context-budget'

/**
 * The tool names, spelled out rather than imported from `session.ts`.
 *
 * That module reaches the TypeScript service registry, which imports Electron's
 * `utilityProcess` — unavailable under `bun test`. Naming them here also keeps the test
 * honest about what it is measuring: the report is a function of a list of names, and
 * nothing about it should depend on how that list was chosen.
 */
const BUILTIN_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']

/** A representative full profile: Pi's built-ins plus Pi Taster's own. */
const FULL_TOOLS = [
  ...BUILTIN_TOOLS,
  'replace_lines',
  'code_intel',
  'refactor',
  'git_status',
  'rollback',
  'create_branch',
  'switch_branch',
  'list_branches',
  'get_history',
  'web_fetch',
  'install_deps',
  'load_skill'
]

/** The lean profile drops the four version tools the user drives from the panel. */
const LEAN_TOOLS = FULL_TOOLS.filter(
  (name) => !['create_branch', 'switch_branch', 'list_branches', 'get_history'].includes(name)
)

type AgentMessage = ContextEvent['messages'][number]

let root = ''
let app: SubApp

const budget = deriveContextBudget({ daemonWindow: 65536 })
const toolNames = FULL_TOOLS

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pitaster-report-'))
  app = {
    id: 'test-app',
    name: 'Test App',
    description: '',
    template: 'react-vite',
    status: 'ready',
    path: root,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Build a report for the temp app.
 * @param messages - The conversation, when the test wants one
 * @param measured - The provider's own count, when the test wants one
 * @returns The report
 */
function report(messages?: AgentMessage[], measured?: number | null) {
  return buildContextReport({
    app,
    budget,
    toolNames,
    builtinToolNames: BUILTIN_TOOLS,
    messages,
    measured
  })
}

/**
 * Look up one block's tokens.
 * @param blocks - The report's blocks
 * @param id - The block id
 * @returns Its tokens, or 0 when the block was dropped as empty
 */
function tokensOf(blocks: { id: string; tokens: number }[], id: string): number {
  return blocks.find((block) => block.id === id)?.tokens ?? 0
}

describe('buildContextReport', () => {
  test('answers with no session at all', async () => {
    const result = await report()

    expect(result.state).toBe('floor')
    expect(result.measured).toBeNull()
    expect(result.estimated).toBeGreaterThan(0)
    expect(result.blocks.every((block) => block.group === 'fixed')).toBe(true)
    expect(tokensOf(result.blocks, 'tool-schemas')).toBeGreaterThan(0)
    expect(tokensOf(result.blocks, 'system-prompt')).toBeGreaterThan(0)
  })

  test('charges every enabled tool a schema', async () => {
    const full = await report()
    const lean = await buildContextReport({
      app,
      budget,
      toolNames: LEAN_TOOLS,
      builtinToolNames: BUILTIN_TOOLS
    })

    // The lean profile drops four version tools. If schemas were not really being
    // measured, both profiles would report the same number.
    expect(tokensOf(lean.blocks, 'tool-schemas')).toBeLessThan(
      tokensOf(full.blocks, 'tool-schemas')
    )
    expect(LEAN_TOOLS.length).toBe(FULL_TOOLS.length - 4)
  })

  test('does not charge the skill manifest twice', async () => {
    // The prompt inlines the manifest and the tool guidance. Were the base block
    // measured as the whole prompt, the blocks would sum past the prompt's real size.
    const result = await report()
    const fixed = result.blocks
      .filter((block) => block.group === 'fixed')
      .reduce((sum, block) => sum + block.tokens, 0)

    expect(result.estimated).toBe(fixed)
    expect(tokensOf(result.blocks, 'system-prompt')).toBeGreaterThan(0)
  })

  test('marks where compaction fires', async () => {
    const result = await report()

    expect(result.window).toBe(budget.window)
    expect(result.compactAt).toBe(budget.window - budget.compaction.reserveTokens)
    expect(result.compactAt).toBeLessThan(result.window)
  })

  test('attributes a conversation by role', async () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello '.repeat(100) }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'sure' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/App.tsx' } }
        ]
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'x'.repeat(8000) }]
      }
    ] as unknown as AgentMessage[]

    const result = await report(messages, 4321)

    expect(result.state).toBe('live')
    expect(result.measured).toBe(4321)
    expect(tokensOf(result.blocks, 'tool-results')).toBeGreaterThan(
      tokensOf(result.blocks, 'user-messages')
    )
    expect(result.hotspots[0].label).toBe('read src/App.tsx')
  })

  test('reports estimated when the provider has not counted yet', async () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] }
    ] as unknown as AgentMessage[]

    // The gap right after a compaction. There is still a conversation to attribute.
    expect((await report(messages, null)).state).toBe('estimated')
  })

  test('prices an image without restating Pi own per-image charge', async () => {
    const text = [{ type: 'text', text: 'look' }]
    const withImage = [
      { role: 'user', content: [...text, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }
    ] as unknown as AgentMessage[]
    const withoutImage = [{ role: 'user', content: text }] as unknown as AgentMessage[]

    const shot = await report(withImage, 1)
    const plain = await report(withoutImage, 1)

    expect(tokensOf(shot.blocks, 'images')).toBeGreaterThan(100)
    expect(tokensOf(plain.blocks, 'images')).toBe(0)
    // The image's cost is separated out, not left inside the message that carried it.
    expect(tokensOf(shot.blocks, 'user-messages')).toBe(
      tokensOf(plain.blocks, 'user-messages')
    )
  })

  test('counts the app own context file', async () => {
    const before = await report()
    await writeFile(join(root, 'AGENTS.md'), '# Test App\n\n'.repeat(200), 'utf-8')
    const after = await report()

    expect(tokensOf(before.blocks, 'context-files')).toBe(0)
    expect(tokensOf(after.blocks, 'context-files')).toBeGreaterThan(0)
    expect(after.blocks.find((block) => block.id === 'context-files')?.label).toBe('AGENTS.md')

    await rm(join(root, 'AGENTS.md'))
  })
})
