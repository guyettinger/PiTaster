/**
 * The operations anyapp asks the TypeScript language service for.
 *
 * Two rules shape every function here.
 *
 * **Symbols are addressed by name, never by line and character.** A local model asked
 * to produce an exact character offset gets it wrong for the same reason it gets an
 * `edit`'s leading indentation wrong — and unlike a failed `edit`, a wrong offset does
 * not error. It resolves whatever token happens to sit there and answers confidently
 * about the wrong thing. So the caller names a symbol and the resolution happens here,
 * against the parsed file. Where a name is genuinely ambiguous the answer is the list
 * of candidates with their line numbers, not a guess.
 *
 * **Nothing from the `ts` namespace leaves this module.** Everything returns the plain
 * shapes in `protocol.ts`, because these results cross a process boundary as JSON.
 */

import ts from 'typescript'
import type {
  Diagnostic,
  FileEdit,
  OutlineEntry,
  ServiceResponse,
  SymbolCandidate,
  SymbolReference
} from './protocol'
import type { TsProject } from './host'

/** Longest signature line kept in an outline entry. */
const MAX_DETAIL_LENGTH = 120

/** Longest source line quoted beside a reference. */
const MAX_REFERENCE_LENGTH = 160

/**
 * What a new name has to look like for {@link rename} to accept it.
 *
 * ASCII only. TypeScript itself allows a much wider set, but `ts.isIdentifierText` is
 * not part of the public typings and a model renaming a symbol to a Unicode identifier
 * is not the case worth reaching into internals for. A rejection here is recoverable;
 * writing a name the compiler then cannot parse is not.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Convert a character offset to the 1-indexed line and column an editor shows.
 * @param sourceFile - The file the offset belongs to
 * @param offset - A character offset into that file
 * @returns The 1-indexed position
 */
function toLineAndColumn(
  sourceFile: ts.SourceFile,
  offset: number
): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset)
  return { line: line + 1, column: character + 1 }
}

/**
 * Read one line of a file's text.
 * @param sourceFile - The file
 * @param line - The line, 1-indexed
 * @returns The line without its terminator
 */
function lineText(sourceFile: ts.SourceFile, line: number): string {
  const starts = sourceFile.getLineStarts()
  const start = starts[line - 1]
  if (start === undefined) return ''
  const end = starts[line] ?? sourceFile.text.length
  return sourceFile.text.slice(start, end).replace(/\r?\n$/, '')
}

/**
 * Truncate a quoted line so one result cannot carry a minified file into the window.
 * @param text - The line
 * @param limit - Longest length to keep
 * @returns The trimmed line, with an ellipsis when it was cut
 */
function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`
}

/**
 * Fetch a source file from the current program.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @returns The parsed file, or `null` if the program does not hold it
 */
function sourceFileOf(project: TsProject, absolutePath: string): ts.SourceFile | null {
  return project.service.getProgram()?.getSourceFile(absolutePath) ?? null
}

/**
 * Every offset in a file at which an identifier of this name appears.
 *
 * Deliberately every *occurrence*, not every declaration. The model usually asks about
 * a name it just read in a file that uses it, and `getDefinitionAtPosition`,
 * `getReferencesAtPosition` and `getQuickInfoAtPosition` all resolve correctly from a
 * use — a declaration is simply the case where the answer points back at itself.
 *
 * @param sourceFile - The file to search
 * @param name - The identifier text to match
 * @returns Offsets in source order
 */
function identifierOffsets(sourceFile: ts.SourceFile, name: string): number[] {
  const offsets: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      offsets.push(node.getStart(sourceFile))
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return offsets
}

/**
 * Walk a navigation tree into a flat outline.
 * @param sourceFile - The file the tree describes
 * @param tree - The navigation tree node
 * @param depth - Nesting depth of this node
 * @param into - Accumulator, appended in source order
 */
function collectOutline(
  sourceFile: ts.SourceFile,
  tree: ts.NavigationTree,
  depth: number,
  into: OutlineEntry[]
): void {
  const isRoot = tree.text === '<global>'
  const span = tree.spans[0]
  if (span && !isRoot) {
    const start = toLineAndColumn(sourceFile, span.start)
    const end = toLineAndColumn(sourceFile, span.start + Math.max(0, span.length - 1))
    into.push({
      name: tree.text,
      kind: String(tree.kind),
      line: start.line,
      endLine: end.line,
      // The declaration's own first line, which for a function or class *is* its
      // signature. Cheaper and more useful than a `quickInfo` call per symbol, which on
      // a forty-symbol file would be forty round trips through the checker.
      detail: clip(lineText(sourceFile, start.line), MAX_DETAIL_LENGTH),
      depth
    })
  }
  for (const child of tree.childItems ?? []) {
    collectOutline(sourceFile, child, isRoot ? depth : depth + 1, into)
  }
}

/**
 * Every entry in a file's outline.
 * @param project - The project handle
 * @param sourceFile - The file to outline
 * @returns Outline entries in source order
 */
function outlineEntries(project: TsProject, sourceFile: ts.SourceFile): OutlineEntry[] {
  const tree = project.service.getNavigationTree(sourceFile.fileName)
  const entries: OutlineEntry[] = []
  if (tree) collectOutline(sourceFile, tree, 0, entries)
  return entries
}

/**
 * Turn outline entries into the candidate list an ambiguous answer carries.
 * @param entries - The matching declarations
 * @returns Candidates for the model to choose between
 */
function toCandidates(entries: OutlineEntry[]): SymbolCandidate[] {
  return entries.map((entry) => ({ name: entry.name, kind: entry.kind, line: entry.line }))
}

/**
 * Resolve a named symbol to a single offset in a file.
 * @param project - The project handle
 * @param sourceFile - The file the model named
 * @param symbol - The identifier to resolve
 * @returns The offset and its line, or a response to return in its place
 */
function resolveSymbol(
  project: TsProject,
  sourceFile: ts.SourceFile,
  symbol: string
): { offset: number; line: number } | ServiceResponse {
  const offsets = identifierOffsets(sourceFile, symbol)
  if (offsets.length === 0) {
    const declarations = outlineEntries(project, sourceFile).filter(
      (entry) => entry.name === symbol
    )
    if (declarations.length > 0) {
      // Reachable when a declaration's name is not an `Identifier` — a string-literal
      // property, say. Answering with the line is more use than "not found".
      return { kind: 'ambiguous', candidates: toCandidates(declarations) }
    }
    return {
      kind: 'notFound',
      message: `No symbol named "${symbol}" appears in ${project.relativize(sourceFile.fileName)}.`
    }
  }
  const offset = offsets[0]!
  return { offset, line: toLineAndColumn(sourceFile, offset).line }
}

/**
 * Apply a set of ranged replacements to a string.
 *
 * Applied last-first so each change's offsets still describe the text it was computed
 * against — the compiler returns them all against the *original* file.
 *
 * @param text - The original text
 * @param changes - The replacements
 * @returns The rewritten text
 */
function applyTextChanges(text: string, changes: readonly ts.TextChange[]): string {
  const ordered = [...changes].sort((a, b) => b.span.start - a.span.start)
  let result = text
  for (const change of ordered) {
    result =
      result.slice(0, change.span.start) +
      change.newText +
      result.slice(change.span.start + change.span.length)
  }
  return result
}

/**
 * Turn the compiler's per-file change sets into whole new file contents.
 * @param project - The project handle
 * @param fileChanges - Change sets as the compiler produced them
 * @returns One entry per rewritten file
 */
function toFileEdits(project: TsProject, fileChanges: readonly ts.FileTextChanges[]): FileEdit[] {
  const edits: FileEdit[] = []
  for (const file of fileChanges) {
    // An `isNewFile` change set describes a file to create. Nothing anyapp asks for
    // produces one, and honouring it would be a write to a path no gate has seen.
    if (file.isNewFile) continue
    // The compiler names these paths, not the model, so `checkConfinement` never saw
    // them — it only ever inspected the one `path` argument. An out-of-root file here
    // relativizes to a string of `../` segments, and rejoining that against the root is
    // an ordinary path traversal that happens to have been computed by tsc.
    if (!project.contains(file.fileName)) continue
    const text = ts.sys.readFile(file.fileName)
    if (text === undefined) continue
    edits.push({
      path: project.relativize(file.fileName),
      text: applyTextChanges(text, file.textChanges)
    })
  }
  return edits
}

/** Format settings used for every compiler-generated edit. */
const FORMAT_SETTINGS: ts.FormatCodeSettings = {
  ...ts.getDefaultFormatCodeSettings('\n'),
  convertTabsToSpaces: true,
  indentSize: 2,
  tabSize: 2
}

/** User preferences used for every compiler-generated edit. */
const PREFERENCES: ts.UserPreferences = {
  quotePreference: 'single',
  importModuleSpecifierEnding: 'auto',
  // Without this, renaming the local in `export const bag = { helper }` rewrites the
  // shorthand to `{ compute }` — which silently changes the property name this module
  // exports. With it, the compiler returns the prefix that keeps the key intact.
  providePrefixAndSuffixTextForRename: true
}

/**
 * The compiler's own diagnostics for a file, unmapped.
 *
 * Syntactic first, and semantic only when there are none: a file that does not parse
 * produces a cascade of meaningless type errors, and reporting both would bury the one
 * error that matters under its own consequences.
 *
 * Kept in the compiler's shape because {@link applyFix} needs each diagnostic's exact
 * character span, which the mapped form deliberately does not carry.
 *
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @returns Diagnostics as the service produced them
 */
function rawDiagnostics(project: TsProject, absolutePath: string): readonly ts.Diagnostic[] {
  const syntactic = project.service.getSyntacticDiagnostics(absolutePath)
  return syntactic.length > 0 ? syntactic : project.service.getSemanticDiagnostics(absolutePath)
}

/**
 * Compiler errors for one file, in anyapp's shape.
 *
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @returns Diagnostics in source order
 */
export function fileDiagnostics(project: TsProject, absolutePath: string): Diagnostic[] {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) return []

  const raw = rawDiagnostics(project, absolutePath)
  const relativePath = project.relativize(absolutePath)
  return raw
    .filter((diagnostic) => diagnostic.start !== undefined)
    .map((diagnostic) => {
      const { line, column } = toLineAndColumn(sourceFile, diagnostic.start!)
      return {
        path: relativePath,
        line,
        column,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        category:
          diagnostic.category === ts.DiagnosticCategory.Error
            ? ('error' as const)
            : ('warning' as const)
      }
    })
    .sort((a, b) => a.line - b.line || a.column - b.column)
}

/**
 * Which project files import a given file.
 *
 * Used to *name* the files an edit may have broken without paying to type check them —
 * a full cascade over every dependent is a real token risk on a 32k window, and the
 * names alone are enough for the model to decide whether to look.
 *
 * @param project - The project handle
 * @param absolutePath - Absolute path to the changed file
 * @returns Root-relative paths of the importers, sorted
 */
export function referencingFiles(project: TsProject, absolutePath: string): string[] {
  const program = project.service.getProgram()
  if (!program) return []

  const options = program.getCompilerOptions()
  const importers: string[] = []

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue
    if (sourceFile.fileName === absolutePath) continue
    if (sourceFile.fileName.includes('/node_modules/')) continue

    for (const statement of sourceFile.statements) {
      const specifier = ts.isImportDeclaration(statement)
        ? statement.moduleSpecifier
        : ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined
      if (!specifier || !ts.isStringLiteral(specifier)) continue

      const resolved = ts.resolveModuleName(
        specifier.text,
        sourceFile.fileName,
        options,
        ts.sys
      ).resolvedModule
      if (resolved?.resolvedFileName === absolutePath) {
        importers.push(project.relativize(sourceFile.fileName))
        break
      }
    }
  }
  return importers.sort()
}

/**
 * A file's symbol outline.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @returns The outline response
 */
export function outline(project: TsProject, absolutePath: string): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }
  return { kind: 'outline', entries: outlineEntries(project, sourceFile) }
}

/**
 * The source text of one declaration.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @param symbol - The declared name to read
 * @returns The text response, or a candidate list when the name is declared more than once
 */
export function readSymbol(
  project: TsProject,
  absolutePath: string,
  symbol: string
): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }

  const matches = outlineEntries(project, sourceFile).filter((entry) => entry.name === symbol)
  if (matches.length === 0) {
    return {
      kind: 'notFound',
      message:
        `Nothing named "${symbol}" is declared in ${project.relativize(absolutePath)}. ` +
        'Call code_intel with operation "outline" to see what is.'
    }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', candidates: toCandidates(matches) }
  }

  const entry = matches[0]!
  const starts = sourceFile.getLineStarts()
  const from = starts[entry.line - 1] ?? 0
  const to = starts[entry.endLine] ?? sourceFile.text.length
  return {
    kind: 'text',
    text: sourceFile.text.slice(from, to).replace(/\r?\n$/, ''),
    line: entry.line,
    endLine: entry.endLine
  }
}

/**
 * Where a symbol is defined.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file the model is reading
 * @param symbol - The identifier to resolve
 * @returns The locations response
 */
export function definition(
  project: TsProject,
  absolutePath: string,
  symbol: string
): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }

  const resolved = resolveSymbol(project, sourceFile, symbol)
  if ('kind' in resolved) return resolved

  const definitions = project.service.getDefinitionAtPosition(absolutePath, resolved.offset) ?? []
  const locations: SymbolReference[] = []
  for (const found of definitions) {
    // Out-of-root results carry a source line from a file the agent may not read. The
    // host refuses those reads now, so this should be unreachable — it stays because a
    // navigation result is where a leak would be least visible if it ever were.
    if (!project.contains(found.fileName)) continue
    const target = sourceFileOf(project, found.fileName)
    if (!target) continue
    const { line, column } = toLineAndColumn(target, found.textSpan.start)
    locations.push({
      path: project.relativize(found.fileName),
      line,
      column,
      text: clip(lineText(target, line), MAX_REFERENCE_LENGTH)
    })
  }

  if (locations.length === 0) {
    return {
      kind: 'notFound',
      message:
        `"${symbol}" resolves to nothing the compiler can locate. ` +
        'It may come from a dependency that ships no type declarations.'
    }
  }
  return { kind: 'locations', locations }
}

/**
 * Every use of a symbol across the project.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file the model is reading
 * @param symbol - The identifier to resolve
 * @returns The locations response
 */
export function references(
  project: TsProject,
  absolutePath: string,
  symbol: string
): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }

  const resolved = resolveSymbol(project, sourceFile, symbol)
  if ('kind' in resolved) return resolved

  const found = project.service.getReferencesAtPosition(absolutePath, resolved.offset) ?? []
  const locations: SymbolReference[] = []
  for (const entry of found) {
    if (!project.contains(entry.fileName)) continue
    const target = sourceFileOf(project, entry.fileName)
    if (!target) continue
    const { line, column } = toLineAndColumn(target, entry.textSpan.start)
    locations.push({
      path: project.relativize(entry.fileName),
      line,
      column,
      text: clip(lineText(target, line), MAX_REFERENCE_LENGTH)
    })
  }
  return { kind: 'locations', locations }
}

/**
 * The resolved type and documentation of a symbol.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file the model is reading
 * @param symbol - The identifier to resolve
 * @returns The text response
 */
export function hover(project: TsProject, absolutePath: string, symbol: string): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }

  const resolved = resolveSymbol(project, sourceFile, symbol)
  if ('kind' in resolved) return resolved

  const info = project.service.getQuickInfoAtPosition(absolutePath, resolved.offset)
  if (!info) {
    return { kind: 'notFound', message: `The compiler has no type information for "${symbol}".` }
  }

  const signature = ts.displayPartsToString(info.displayParts ?? [])
  const documentation = ts.displayPartsToString(info.documentation ?? [])
  const text = documentation ? `${signature}\n\n${documentation}` : signature
  return { kind: 'text', text, line: resolved.line, endLine: resolved.line }
}

/**
 * Rename a symbol everywhere it is used.
 * @param project - The project handle
 * @param absolutePath - Absolute path to a file the symbol appears in
 * @param symbol - The identifier to rename
 * @param newName - The new name
 * @returns The edits response
 */
export function rename(
  project: TsProject,
  absolutePath: string,
  symbol: string,
  newName: string
): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }
  if (!IDENTIFIER_PATTERN.test(newName)) {
    return { kind: 'notFound', message: `"${newName}" is not a valid identifier.` }
  }

  const resolved = resolveSymbol(project, sourceFile, symbol)
  if ('kind' in resolved) return resolved

  const locations = project.service.findRenameLocations(
    absolutePath,
    resolved.offset,
    false,
    false,
    PREFERENCES
  )
  if (!locations || locations.length === 0) {
    return {
      kind: 'notFound',
      message:
        `"${symbol}" cannot be renamed from here. ` +
        'It may be declared in a dependency, which is outside this app.'
    }
  }

  const byFile = new Map<string, ts.TextChange[]>()
  for (const location of locations) {
    const changes = byFile.get(location.fileName) ?? []
    changes.push({
      span: location.textSpan,
      // `prefixText`/`suffixText` are how the compiler expresses a shorthand property
      // that has to become `newName: original` to keep binding the same thing. Dropping
      // them would silently change what an object literal means.
      newText: `${location.prefixText ?? ''}${newName}${location.suffixText ?? ''}`
    })
    byFile.set(location.fileName, changes)
  }

  const edits = toFileEdits(
    project,
    [...byFile].map(([fileName, textChanges]) => ({ fileName, textChanges }))
  )
  return {
    kind: 'edits',
    edits,
    description: `Renamed ${symbol} to ${newName} across ${edits.length} file(s), ${locations.length} occurrence(s).`
  }
}

/**
 * Sort and prune a file's imports.
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @returns The edits response, or `ok` when there was nothing to change
 */
export function organizeImports(project: TsProject, absolutePath: string): ServiceResponse {
  const changes = project.service.organizeImports(
    { type: 'file', fileName: absolutePath },
    FORMAT_SETTINGS,
    PREFERENCES
  )
  const edits = toFileEdits(project, changes)
  if (edits.length === 0) return { kind: 'ok' }
  return { kind: 'edits', edits, description: `Organized imports in ${edits.length} file(s).` }
}

/**
 * Apply the compiler's own fix for the error on a line.
 *
 * The line number is the one anyapp printed in the diagnostics attached to the model's
 * last write — the same pairing that makes `replace_lines` usable, where the numbers
 * arrive attached to the failure that needs them.
 *
 * @param project - The project handle
 * @param absolutePath - Absolute path to the file
 * @param line - The 1-indexed line carrying the error
 * @returns The edits response
 */
export function applyFix(project: TsProject, absolutePath: string, line: number): ServiceResponse {
  const sourceFile = sourceFileOf(project, absolutePath)
  if (!sourceFile) {
    return {
      kind: 'notFound',
      message: `${project.relativize(absolutePath)} is not in the project.`
    }
  }

  const onLine = rawDiagnostics(project, absolutePath).filter(
    (diagnostic) =>
      diagnostic.start !== undefined &&
      toLineAndColumn(sourceFile, diagnostic.start).line === line
  )
  if (onLine.length === 0) {
    return {
      kind: 'notFound',
      message: `No compiler error on line ${line} of ${project.relativize(absolutePath)}.`
    }
  }

  // One request per diagnostic, at that diagnostic's own span. Asking over the whole
  // line instead looks harmless and is not: the compiler searches the range for
  // anything matching the error codes, and on a line reading
  // `export const value = shape.widht` it answers error 2551 with "change spelling of
  // `export` to `Report`" — a well-formed fix that silently corrupts the file.
  for (const diagnostic of onLine) {
    const start = diagnostic.start!
    const fixes = project.service.getCodeFixesAtPosition(
      absolutePath,
      start,
      start + (diagnostic.length ?? 0),
      [diagnostic.code],
      FORMAT_SETTINGS,
      PREFERENCES
    )

    const fix = fixes[0]
    if (!fix) continue

    const edits = toFileEdits(project, fix.changes)
    if (edits.length === 0) continue
    return { kind: 'edits', edits, description: fix.description }
  }

  return {
    kind: 'notFound',
    message:
      `The compiler offers no automatic fix for "` +
      ts.flattenDiagnosticMessageText(onLine[0]!.messageText, ' ') +
      `". Edit the file directly.`
  }
}
