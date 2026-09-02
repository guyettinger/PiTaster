/**
 * Tests for the diagnostics appended to a write's tool result.
 *
 * Two properties matter more than the wording. The block has to stay small, because
 * `edit` and `write` are outside `TRUNCATABLE_TOOLS` and nothing downstream will cut it.
 * And an unavailable service has to be silent, because this runs inside the agent's turn
 * and a code-intelligence layer that can fail the edit loop is worse than none.
 */

import { describe, expect, test } from 'bun:test'
import {
  createDiagnosticsNotifier,
  formatDiagnosticsNote,
  type DiagnosticsSource
} from './diagnostics-note'
import type { Diagnostic, ServiceResponse } from './ts-service/protocol'

/**
 * Build a diagnostic.
 * @param line - The line it sits on
 * @param message - Its text
 * @returns The diagnostic
 */
function error(line: number, message: string): Diagnostic {
  return { path: 'src/App.tsx', line, column: 1, code: 2322, message, category: 'error' }
}

/**
 * A source that answers from a fixed script.
 * @param answers - What to return per request kind, keyed by path where relevant
 * @returns The source, plus the requests it received
 */
function scriptedSource(answers: {
  /** Errors per path. */
  diagnostics?: Record<string, Diagnostic[]>
  /** Importers per path. */
  importers?: Record<string, string[]>
  /** Return `unavailable` for everything. */
  unavailable?: boolean
}): { source: DiagnosticsSource; seen: string[] } {
  const seen: string[] = []

  const source: DiagnosticsSource = {
    request: async (request) => {
      seen.push(request.kind)
      if (answers.unavailable) {
        return { kind: 'unavailable', message: 'no service' } satisfies ServiceResponse
      }
      if (request.kind === 'invalidate') return { kind: 'ok' }
      if (request.kind === 'diagnostics') {
        return { kind: 'diagnostics', diagnostics: answers.diagnostics?.[request.path] ?? [] }
      }
      return { kind: 'paths', paths: answers.importers?.[request.path] ?? [] }
    }
  }

  return { source, seen }
}

describe('formatDiagnosticsNote', () => {
  test('says nothing when the file is clean and nothing else broke', () => {
    expect(
      formatDiagnosticsNote({ path: 'src/App.tsx', errors: [], brokenDependents: [] })
    ).toBeNull()
  })

  test('quotes each error with the line number apply_fix takes', () => {
    const note = formatDiagnosticsNote({
      path: 'src/App.tsx',
      errors: [error(12, 'Type string is not assignable to type number.')],
      brokenDependents: []
    })

    expect(note).toContain('1 TypeScript error in src/App.tsx')
    expect(note).toContain('12:1')
    expect(note).toContain('apply_fix')
  })

  test('caps the quoted errors and counts the rest', () => {
    const errors = Array.from({ length: 30 }, (_, index) => error(index + 1, 'broken'))

    const note = formatDiagnosticsNote({ path: 'src/App.tsx', errors, brokenDependents: [] })!

    expect(note).toContain('30 TypeScript errors')
    expect(note).toContain('and 22 more')
    // The whole point of capping at the source: this block is never trimmed later.
    expect(note.split('\n').length).toBeLessThan(14)
  })

  test('truncates a single enormous message', () => {
    const note = formatDiagnosticsNote({
      path: 'src/App.tsx',
      errors: [error(1, 'x'.repeat(5000))],
      brokenDependents: []
    })!

    expect(note.length).toBeLessThan(700)
    expect(note).toContain('…')
  })

  test('names broken dependents without their errors', () => {
    const note = formatDiagnosticsNote({
      path: 'src/lib.ts',
      errors: [],
      brokenDependents: ['src/a.ts', 'src/b.ts']
    })!

    expect(note).toContain('src/a.ts, src/b.ts')
    expect(note).toContain('not listed here')
  })

  test('counts dependents past the cap rather than naming them all', () => {
    const dependents = Array.from({ length: 12 }, (_, index) => `src/f${index}.ts`)

    const note = formatDiagnosticsNote({
      path: 'src/lib.ts',
      errors: [],
      brokenDependents: dependents
    })!

    expect(note).toContain('and 7 more')
  })
})

describe('createDiagnosticsNotifier', () => {
  test('invalidates before reading, or it describes the file as it was', async () => {
    const { source, seen } = scriptedSource({ diagnostics: { 'src/App.tsx': [] } })

    await createDiagnosticsNotifier({ source }).check('src/App.tsx')

    expect(seen[0]).toBe('invalidate')
  })

  test('says nothing at all when the service is unavailable', async () => {
    const { source } = scriptedSource({ unavailable: true })

    expect(await createDiagnosticsNotifier({ source }).check('src/App.tsx')).toBeNull()
  })

  test('reports the errors in the file that was written', async () => {
    const { source } = scriptedSource({
      diagnostics: { 'src/App.tsx': [error(3, 'broken')] }
    })

    const note = await createDiagnosticsNotifier({ source }).check('src/App.tsx')

    expect(note).toContain('3:1')
  })

  test('ignores warnings', async () => {
    const { source } = scriptedSource({
      diagnostics: {
        'src/App.tsx': [{ ...error(3, 'just a hint'), category: 'warning' as const }]
      }
    })

    expect(await createDiagnosticsNotifier({ source }).check('src/App.tsx')).toBeNull()
  })

  test('claims nothing about a dependent it has never checked', async () => {
    const { source } = scriptedSource({
      diagnostics: { 'src/lib.ts': [], 'src/a.ts': [error(1, 'was already broken')] },
      importers: { 'src/lib.ts': ['src/a.ts'] }
    })

    // First edit: `src/a.ts` is failing, but nothing recorded says it was passing before,
    // so blaming this edit for it would be a guess dressed as a fact.
    expect(await createDiagnosticsNotifier({ source }).check('src/lib.ts')).toBeNull()
  })

  test('reports a dependent that was passing and now is not', async () => {
    const errors: Record<string, Diagnostic[]> = { 'src/lib.ts': [], 'src/a.ts': [] }
    const source: DiagnosticsSource = {
      request: async (request) => {
        if (request.kind === 'invalidate') return { kind: 'ok' }
        if (request.kind === 'referencingFiles') return { kind: 'paths', paths: ['src/a.ts'] }
        return { kind: 'diagnostics', diagnostics: errors[request.path] ?? [] }
      }
    }
    const notifier = createDiagnosticsNotifier({ source })

    // First pass records that `src/a.ts` was clean.
    expect(await notifier.check('src/lib.ts')).toBeNull()

    errors['src/a.ts'] = [error(4, 'broken by the change next door')]
    const note = await notifier.check('src/lib.ts')

    expect(note).toContain('src/a.ts')
    expect(note).toContain('broke')
    // Names only. Its errors are not quoted.
    expect(note).not.toContain('broken by the change next door')
  })
})
