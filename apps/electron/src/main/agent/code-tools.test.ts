/**
 * Tests for the `refactor` tool's apply path.
 *
 * `queries.test.ts` already proves the compiler computes the right edits. What is only
 * reachable here is what happens to them afterwards: that every rewritten file lands on
 * disk, that they are committed *together*, and that a rename which cannot be applied
 * leaves the tree untouched rather than half-changed.
 *
 * The multi-file commit is the part worth a test of its own. `autoCommitToolResult`
 * commits exactly one path, so a rename routed through it would commit the declaration
 * and leave the call sites untracked — a later `rollback` would then restore the old name
 * in one file and keep the new one everywhere else.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import git from 'isomorphic-git'
import fs from 'node:fs'
import { VersionManager } from '@pitaster/shared'
import { createCodeTools, CODE_TOOL_NAMES } from './code-tools'
import { createTsProject } from './ts-service/host'
import * as queries from './ts-service/queries'
import type { ServiceRequest, ServiceResponse } from './ts-service/protocol'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pitaster-code-tools-'))
  await git.init({ fs, dir: root, defaultBranch: 'main' })
})

/**
 * Write a fixture file.
 * @param path - Path relative to the scratch root
 * @param content - The file's contents
 */
async function write(path: string, content: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf-8')
}

/**
 * Answer service requests in-process, against a real language service.
 *
 * The worker exists to keep the compiler off the main thread, not to change what it
 * answers, so driving `queries` directly tests the same code the worker runs.
 *
 * @param request - The query
 * @returns The response
 */
async function request(request: ServiceRequest): Promise<ServiceResponse> {
  const project = createTsProject(root)
  if (request.kind === 'invalidate') return { kind: 'ok' }
  if (request.kind !== 'rename' && request.kind !== 'organizeImports') {
    return { kind: 'unavailable', message: 'not used by these tests' }
  }
  const absolute = project.resolve(request.path)!
  return request.kind === 'rename'
    ? queries.rename(project, absolute, request.symbol, request.newName)
    : queries.organizeImports(project, absolute)
}

/**
 * Build the `refactor` tool over a service that answers with a fixed edit set.
 *
 * Used to feed `applyEdits` a path the compiler could plausibly produce and the model
 * never typed. Going through the real language service cannot reach this case reliably —
 * the host now refuses the reads that would create it — which is exactly why the write
 * guard needs a test of its own rather than relying on the layers above it.
 *
 * @param edits - What the service should claim the refactor produces
 * @returns The `refactor` tool
 */
function refactorToolReturning(edits: Array<{ path: string; text: string }>) {
  const tools = createCodeTools({
    rootPath: root,
    request: async (request): Promise<ServiceResponse> =>
      request.kind === 'invalidate'
        ? { kind: 'ok' }
        : { kind: 'edits', edits, description: 'hostile rename' },
    getAutoCommit: () => false
  })
  return tools.find((tool) => tool.name === 'refactor')!
}

/**
 * Build the `refactor` tool over the scratch root.
 * @param autoCommit - Whether auto-commit is on
 * @returns The tool definition
 */
function refactorTool(autoCommit = true) {
  const tools = createCodeTools({ rootPath: root, request, getAutoCommit: () => autoCommit })
  return tools.find((tool) => tool.name === 'refactor')!
}

/**
 * Run the tool and return its text output.
 * @param input - The tool arguments
 * @returns The message the model would see
 */
async function run(input: Record<string, unknown>): Promise<string> {
  const result = await refactorTool().execute(
    'call-1',
    input as never,
    new AbortController().signal,
    undefined as never,
    undefined as never
  )
  return result.content.map((block) => ('text' in block ? block.text : '')).join('\n')
}

describe('the tool surface', () => {
  test('names both tools for the session allowlist', () => {
    expect([...CODE_TOOL_NAMES]).toEqual(['code_intel', 'refactor'])
  })

  test('rejects a rename missing its new name before touching anything', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')

    const text = await run({ operation: 'rename', path: 'lib.ts', symbol: 'helper' })

    expect(text).toContain('needs both symbol and newName')
    expect(await readFile(join(root, 'lib.ts'), 'utf-8')).toContain('helper')
  })

  test('rejects apply_fix without a line rather than guessing one', async () => {
    await write('lib.ts', 'export const a = 1\n')

    expect(await run({ operation: 'apply_fix', path: 'lib.ts' })).toContain('needs the line number')
  })
})

describe('rename', () => {
  test('rewrites every file on disk and lists them', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    await write('a.ts', "import { helper } from './lib'\nexport const a = helper()\n")
    await write('b.ts', "import { helper } from './lib'\nexport const b = helper()\n")

    const text = await run({
      operation: 'rename',
      path: 'lib.ts',
      symbol: 'helper',
      newName: 'compute'
    })

    for (const path of ['lib.ts', 'a.ts', 'b.ts']) {
      const contents = await readFile(join(root, path), 'utf-8')
      expect(contents).toContain('compute')
      expect(contents).not.toContain('helper')
      expect(text).toContain(path)
    }
  })

  test('commits every rewritten file in one commit', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    await write('a.ts', "import { helper } from './lib'\nexport const a = helper()\n")
    await git.add({ fs, dir: root, filepath: 'lib.ts' })
    await git.add({ fs, dir: root, filepath: 'a.ts' })
    await git.commit({
      fs,
      dir: root,
      message: 'initial',
      author: { name: 'test', email: 'test@example.com' }
    })

    await run({ operation: 'rename', path: 'lib.ts', symbol: 'helper', newName: 'compute' })

    // Nothing left uncommitted: a rename that commits the declaration and not the call
    // sites is the failure this is here to catch.
    const state = await new VersionManager(root).getState()
    expect(state.hasChanges).toBe(false)
    expect(state.modifiedFiles).toEqual([])

    const log = await git.log({ fs, dir: root, depth: 1 })
    expect(log[0]!.commit.message).toContain('refactor')
  })

  test('leaves the tree alone when the compiler refuses the rename', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    const before = await readFile(join(root, 'lib.ts'), 'utf-8')

    const text = await run({
      operation: 'rename',
      path: 'lib.ts',
      symbol: 'helper',
      newName: 'not a name'
    })

    expect(text).toContain('not a valid identifier')
    expect(await readFile(join(root, 'lib.ts'), 'utf-8')).toBe(before)
  })
})

describe('containment at the write itself', () => {
  test('refuses an edit path that climbs out of the app root', async () => {
    const outside = join(root, '..', `escape-write-${Date.now()}.ts`)
    await writeFile(outside, 'untouched\n', 'utf-8')

    // `relative()` on an out-of-root file returns `../` segments, and `join(root, that)`
    // resolves straight back out — a path traversal that happens to have been computed
    // by the compiler rather than typed by the model, so nothing that inspects tool
    // arguments would ever see it.
    const tool = refactorToolReturning([
      { path: `../${outside.split('/').pop()}`, text: 'OVERWRITTEN\n' }
    ])
    const result = await tool.execute(
      'call-1',
      { operation: 'rename', path: 'lib.ts', symbol: 'a', newName: 'b' } as never,
      new AbortController().signal,
      undefined as never,
      undefined as never
    )
    const text = result.content.map((block) => ('text' in block ? block.text : '')).join('\n')

    expect(text).toContain('outside this app')
    expect(await readFile(outside, 'utf-8')).toBe('untouched\n')
  })

  test('still writes an ordinary in-root edit', async () => {
    await write('lib.ts', 'before\n')

    const tool = refactorToolReturning([{ path: 'lib.ts', text: 'after\n' }])
    await tool.execute(
      'call-1',
      { operation: 'organize_imports', path: 'lib.ts' } as never,
      new AbortController().signal,
      undefined as never,
      undefined as never
    )

    expect(await readFile(join(root, 'lib.ts'), 'utf-8')).toBe('after\n')
  })
})

describe('organize_imports', () => {
  test('writes the pruned file', async () => {
    await write('lib.ts', 'export const used = 1\nexport const unused = 2\n')
    await write('main.ts', "import { used, unused } from './lib'\nexport const value = used\n")

    await run({ operation: 'organize_imports', path: 'main.ts' })

    expect(await readFile(join(root, 'main.ts'), 'utf-8')).not.toContain('unused')
  })

  test('says so when there is nothing to change', async () => {
    await write('main.ts', 'export const value = 1\n')

    expect(await run({ operation: 'organize_imports', path: 'main.ts' })).toContain(
      'Nothing to change'
    )
  })
})
