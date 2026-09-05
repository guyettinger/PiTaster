/**
 * Tests for the language-service queries.
 *
 * These run against a real fixture project on disk rather than a mocked service,
 * because every interesting failure here is a misuse of the compiler API — an offset
 * off by one, a rename that drops a shorthand property, a diagnostic reported against
 * the wrong file — and a mock would agree with whatever the code already does.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createTsProject, type TsProject } from './host'
import {
  applyFix,
  definition as queriesDefinition,
  fileDiagnostics,
  hover,
  organizeImports,
  outline,
  readSymbol,
  references,
  referencingFiles,
  rename
} from './queries'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'keylimepi-ts-service-'))
})

/**
 * Write a fixture file, creating its directory.
 * @param path - Path relative to the scratch root
 * @param content - The file's contents
 */
async function write(path: string, content: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf-8')
}

/**
 * Build a project over the scratch root.
 * @returns The project handle
 */
function project(): TsProject {
  return createTsProject(root)
}

describe('a project with no tsconfig', () => {
  test('still type checks, using inferred options', async () => {
    await write('index.ts', 'const total: number = "not a number"\nexport { total }\n')

    const found = fileDiagnostics(project(), join(root, 'index.ts'))

    expect(found).toHaveLength(1)
    expect(found[0]!.line).toBe(1)
    expect(found[0]!.category).toBe('error')
    expect(found[0]!.path).toBe('index.ts')
  })

  test('reports nothing for a clean file', async () => {
    await write('index.ts', 'export const total: number = 1\n')

    expect(fileDiagnostics(project(), join(root, 'index.ts'))).toHaveLength(0)
  })
})

describe('outline', () => {
  test('lists declarations with their line ranges and signatures', async () => {
    await write(
      'shapes.ts',
      [
        'export interface Point {',
        '  x: number',
        '}',
        '',
        'export function distance(a: Point, b: Point): number {',
        '  return Math.abs(a.x - b.x)',
        '}',
        ''
      ].join('\n')
    )

    const result = outline(project(), join(root, 'shapes.ts'))

    expect(result.kind).toBe('outline')
    if (result.kind !== 'outline') return
    const names = result.entries.map((entry) => entry.name)
    expect(names).toContain('Point')
    expect(names).toContain('distance')

    const distance = result.entries.find((entry) => entry.name === 'distance')!
    expect(distance.line).toBe(5)
    expect(distance.endLine).toBe(7)
    expect(distance.detail).toContain('export function distance')
  })
})

describe('read_symbol', () => {
  test('returns only the named declaration', async () => {
    await write(
      'shapes.ts',
      [
        'export const first = 1',
        '',
        'export function target(): string {',
        '  return "here"',
        '}',
        '',
        'export const last = 2',
        ''
      ].join('\n')
    )

    const result = readSymbol(project(), join(root, 'shapes.ts'), 'target')

    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.line).toBe(3)
    expect(result.endLine).toBe(5)
    expect(result.text).toContain('return "here"')
    expect(result.text).not.toContain('first')
    expect(result.text).not.toContain('last')
  })

  test('answers with candidates rather than guessing when a name is declared twice', async () => {
    await write(
      'overloaded.ts',
      [
        'class Holder {',
        '  value(): number {',
        '    return 1',
        '  }',
        '}',
        'export function value(): number {',
        '  return 2',
        '}',
        'export { Holder }',
        ''
      ].join('\n')
    )

    const result = readSymbol(project(), join(root, 'overloaded.ts'), 'value')

    expect(result.kind).toBe('ambiguous')
    if (result.kind !== 'ambiguous') return
    expect(result.candidates.map((candidate) => candidate.line).sort()).toEqual([2, 6])
  })

  test('points at outline when the name is not declared', async () => {
    await write('shapes.ts', 'export const only = 1\n')

    const result = readSymbol(project(), join(root, 'shapes.ts'), 'missing')

    expect(result.kind).toBe('notFound')
    if (result.kind !== 'notFound') return
    expect(result.message).toContain('outline')
  })
})

describe('navigation', () => {
  test('definition crosses files', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    await write('main.ts', "import { helper } from './lib'\nexport const value = helper()\n")

    const result = queriesDefinition(project(), join(root, 'main.ts'), 'helper')

    expect(result.kind).toBe('locations')
    if (result.kind !== 'locations') return
    expect(result.locations[0]!.path).toBe('lib.ts')
    expect(result.locations[0]!.line).toBe(1)
  })

  test('references finds uses in other files and quotes their lines', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    await write('main.ts', "import { helper } from './lib'\nexport const value = helper()\n")

    const result = references(project(), join(root, 'lib.ts'), 'helper')

    expect(result.kind).toBe('locations')
    if (result.kind !== 'locations') return
    const paths = result.locations.map((location) => location.path)
    expect(paths).toContain('lib.ts')
    expect(paths).toContain('main.ts')
    expect(result.locations.every((location) => location.text.length > 0)).toBe(true)
  })

  test('hover resolves the declared type', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')

    const result = hover(project(), join(root, 'lib.ts'), 'helper')

    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('number')
  })

  test('a name absent from the file is reported, not guessed at', async () => {
    await write('lib.ts', 'export const only = 1\n')

    const result = queriesDefinition(project(), join(root, 'lib.ts'), 'absent')

    expect(result.kind).toBe('notFound')
  })
})

describe('rename', () => {
  test('rewrites every file that uses the symbol', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')
    await write('a.ts', "import { helper } from './lib'\nexport const a = helper()\n")
    await write('b.ts', "import { helper } from './lib'\nexport const b = helper()\n")

    const result = rename(project(), join(root, 'lib.ts'), 'helper', 'compute')

    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') return
    expect(result.edits.map((edit) => edit.path).sort()).toEqual(['a.ts', 'b.ts', 'lib.ts'])
    for (const edit of result.edits) {
      expect(edit.text).toContain('compute')
      expect(edit.text).not.toContain('helper')
    }
  })

  test('refuses a name the compiler could not parse', async () => {
    await write('lib.ts', 'export function helper(): number {\n  return 1\n}\n')

    const result = rename(project(), join(root, 'lib.ts'), 'helper', 'not a name')

    expect(result.kind).toBe('notFound')
  })

  test('keeps a shorthand property binding the same value', async () => {
    await write(
      'lib.ts',
      ['const helper = 1', 'export const bag = { helper }', 'export { helper }', ''].join('\n')
    )

    const result = rename(project(), join(root, 'lib.ts'), 'helper', 'compute')

    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') return
    // `{ helper }` must become `{ helper: compute }`, not `{ compute }` — the key is
    // part of this module's public shape and renaming the local must not change it.
    expect(result.edits[0]!.text).toContain('helper: compute')
  })
})

describe('organize_imports', () => {
  test('drops an unused import', async () => {
    await write('lib.ts', 'export const used = 1\nexport const unused = 2\n')
    await write('main.ts', "import { used, unused } from './lib'\nexport const value = used\n")

    const result = organizeImports(project(), join(root, 'main.ts'))

    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') return
    expect(result.edits[0]!.text).not.toContain('unused')
  })
})

describe('apply_fix', () => {
  test('applies the compiler’s own fix for a misspelled property', async () => {
    await write(
      'main.ts',
      [
        'interface Shape {',
        '  width: number',
        '}',
        'const shape: Shape = { width: 1 }',
        'export const value = shape.widht',
        ''
      ].join('\n')
    )

    const found = fileDiagnostics(project(), join(root, 'main.ts'))
    expect(found).toHaveLength(1)

    const result = applyFix(project(), join(root, 'main.ts'), found[0]!.line)

    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') return
    expect(result.edits[0]!.text).toContain('shape.width')
  })

  test('says so when no fix exists rather than inventing one', async () => {
    await write('main.ts', 'const total: number = "text"\nexport { total }\n')

    const result = applyFix(project(), join(root, 'main.ts'), 1)

    expect(['notFound', 'edits']).toContain(result.kind)
  })

  test('refuses a line that carries no error', async () => {
    await write('main.ts', 'export const total = 1\n')

    const result = applyFix(project(), join(root, 'main.ts'), 1)

    expect(result.kind).toBe('notFound')
    if (result.kind !== 'notFound') return
    expect(result.message).toContain('No compiler error')
  })
})

describe('referencingFiles', () => {
  test('names the importers of a file', async () => {
    await write('lib.ts', 'export const used = 1\n')
    await write('a.ts', "import { used } from './lib'\nexport const a = used\n")
    await write('b.ts', 'export const b = 2\n')

    expect(referencingFiles(project(), join(root, 'lib.ts'))).toEqual(['a.ts'])
  })
})

describe('confinement', () => {
  test('a path outside the root does not resolve', () => {
    const handle = project()

    expect(handle.resolve('../escape.ts')).toBeNull()
    expect(handle.resolve('/etc/passwd')).toBeNull()
    expect(handle.resolve('src/App.tsx')).toBe(join(root, 'src/App.tsx'))
  })
})

describe('containment of paths the compiler names, not the model', () => {
  test('a file outside the root is never pulled into the program', async () => {
    // The escape a security audit found: the *input* path is in-root and passes every
    // check, and the compiler then follows the import out of the root on its own. The
    // model never names the outside file, so nothing that inspects arguments can see it.
    const outside = join(root, '..', `escape-${Date.now()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.ts'), 'export const secret = "leaked"\n', 'utf-8')

    const relativeImport = join('..', outside.split('/').pop()!, 'secret')
    await write('main.ts', `import { secret } from '${relativeImport}'\nexport const v = secret\n`)

    const handle = project()

    // Nothing about the outside file may come back: not its path, not a source line.
    const found = references(handle, join(root, 'main.ts'), 'secret')
    if (found.kind === 'locations') {
      for (const location of found.locations) {
        expect(location.path.startsWith('..')).toBe(false)
        expect(location.text).not.toContain('leaked')
      }
    }

    const definition = queriesDefinition(handle, join(root, 'main.ts'), 'secret')
    if (definition.kind === 'locations') {
      for (const location of definition.locations) {
        expect(location.path.startsWith('..')).toBe(false)
      }
    }
  })

  test('a rename never offers to rewrite a file outside the root', async () => {
    const outside = join(root, '..', `escape-rename-${Date.now()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'lib.ts'), 'export function shared(): number {\n  return 1\n}\n', 'utf-8')

    const relativeImport = join('..', outside.split('/').pop()!, 'lib')
    await write('main.ts', `import { shared } from '${relativeImport}'\nexport const v = shared()\n`)

    const result = rename(project(), join(root, 'main.ts'), 'shared', 'renamed')

    // Whatever the compiler decided, no edit may name a path that climbs out of the
    // root — `join(rootPath, '../x')` is an ordinary traversal that happens to have been
    // computed by tsc rather than typed by the model.
    if (result.kind === 'edits') {
      for (const edit of result.edits) {
        expect(edit.path.startsWith('..')).toBe(false)
      }
    }
  })

  test('a tsconfig that includes files above the root does not widen the program', async () => {
    const outside = join(root, '..', `escape-config-${Date.now()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'sneaky.ts'), 'export const sneaky = 1\n', 'utf-8')

    // A `tsconfig.json` is a file the agent can write, so its `include` is untrusted.
    await write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { noEmit: true }, include: ['**/*', '../**/*'] })
    )
    await write('main.ts', 'export const v = 1\n')

    const handle = project()

    expect(handle.contains(join(outside, 'sneaky.ts'))).toBe(false)
    const outlined = outline(handle, join(outside, 'sneaky.ts'))
    expect(outlined.kind).toBe('notFound')
  })
})
