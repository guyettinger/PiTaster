/**
 * The compiler, as two tools.
 *
 * **Why two and not ten.** Every tool's name, description and JSON schema ride in every
 * request, and `resolveToolNames` already *removes* four version tools below 32k because
 * a long list measurably worsens which tool a small model picks. Ten separate LSP tools
 * — the shape every published Pi LSP extension takes — would invert that. So navigation
 * is one tool with an `operation` enum and the writes are another.
 *
 * **Why not one.** `checkPermission` classifies by tool *name*. A single tool that could
 * both navigate and rename would have to be classified as a write, and `plan` mode would
 * lose navigation entirely — which is the mode where navigating is most of the point.
 *
 * **Why symbols are named, not addressed.** Nothing here takes a line and character. A
 * local model asked for an exact offset gets it wrong for the same reason it gets an
 * `edit`'s leading indentation wrong, and unlike a failed `edit` a wrong offset does not
 * fail — it answers confidently about whatever token happened to be there. The one
 * exception is `apply_fix`, whose `line` is the number Key Lime Pi printed in the diagnostics
 * attached to the model's last write. That is the same pairing that makes `replace_lines`
 * usable: the number arrives attached to the failure that needs it.
 *
 * **Confinement is in three places, and it took all three.** `checkConfinement` refuses
 * an out-of-root `path` before `execute` runs — but that is the only path *the model*
 * names. The compiler names others: module resolution follows an import wherever it
 * leads, so a `references` result or a rename's edit list can contain a file outside the
 * root, and `relative()` on such a file returns `../` segments that rejoin against the
 * root as an ordinary traversal. So the host refuses the reads that would pull those
 * files into the program (`ts-service/host.ts`), the queries drop any result naming one
 * (`ts-service/queries.ts`), and `applyEdits` below re-checks every path it is about to
 * write. The last is the one that has to be right.
 *
 * Neither tool carries `promptSnippet` or `promptGuidelines`, though Pi's own tools do
 * and Pi's docs recommend them. They would be dead metadata here: Key Lime Pi supplies
 * `systemPromptOverride`, which puts `buildSystemPrompt` on its `customPrompt` early
 * return and drops every tool's contributions — `tool-guidance.ts` exists precisely to
 * put Pi's back, and it reads from Pi's built-in factories, not from these. So the
 * guidance that has to reach the model lives in `system-prompt.ts`, and the `description`
 * carries the rest, since that does ride in the function-calling payload. Two copies of
 * the same sentences, one of which is never read, is how they drift.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Type } from 'typebox'
import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool, withFileMutationQueue, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { FilePatch } from '@keylimepi/core'
import { autoCommitRefactor } from './auto-commit'
import { buildPatch } from './patch'
import { isWithinRoot, resolveLikePi } from './permission-gate'
import { numberLines } from './file-lines'
import type { ServiceRequest, ServiceResponse } from './ts-service/protocol'

/** Locations listed in full before the rest become a count. */
const MAX_LISTED_LOCATIONS = 40

/** Outline entries listed in full before the rest become a count. */
const MAX_OUTLINE_ENTRIES = 120

/** Rewritten files named in full before the rest become a count. */
const MAX_LISTED_FILES = 40

/**
 * A Pi tool result carrying one block of text.
 */
interface TextToolResult {
  /** The result content. */
  content: Array<{ type: 'text'; text: string }>
  /** Structured detail, read by the UI and never sent to the model. */
  details: Record<string, unknown>
  /** Set when the model should treat this as a failure. */
  isError?: boolean
}

/**
 * Wrap text as a tool result.
 * @param text - The message for the model
 * @param details - Structured detail for the UI
 * @returns A Pi tool result
 */
function textResult(text: string, details: Record<string, unknown> = {}): TextToolResult {
  return { content: [{ type: 'text', text }], details }
}

/**
 * Render a service response as text for the model.
 *
 * The `edits` case is deliberately absent: an edits response is a change to apply, not
 * a message, and is handled by the caller that asked for it.
 *
 * @param params - The response and the path it concerns
 * @returns The message, or `null` when the response is an edit set
 */
function renderResponse(params: { response: ServiceResponse; path: string }): string | null {
  const { response, path } = params

  switch (response.kind) {
    case 'unavailable':
      // Deliberately not an error. The model asked a reasonable question and the
      // service could not answer it; the recovery is `read` and `grep`, which always
      // work, and saying so is more useful than a failure the model has to interpret.
      return `Code intelligence is unavailable: ${response.message} Use read and grep instead.`

    case 'notFound':
      return response.message

    case 'ambiguous':
      return [
        `"${response.candidates[0]?.name ?? ''}" is declared more than once in ${path}. ` +
          'Say which one by reading the lines below, then narrow the file or the name.',
        ...response.candidates.map(
          (candidate) => `  line ${candidate.line}  ${candidate.kind} ${candidate.name}`
        )
      ].join('\n')

    case 'diagnostics':
      if (response.diagnostics.length === 0) return `No compiler errors in ${path}.`
      return [
        `${response.diagnostics.length} diagnostic(s) in ${path}:`,
        ...response.diagnostics.map(
          (entry) => `  ${entry.line}:${entry.column}  ${entry.category}  ${entry.message}`
        )
      ].join('\n')

    case 'outline': {
      if (response.entries.length === 0) return `${path} declares nothing.`
      const shown = response.entries.slice(0, MAX_OUTLINE_ENTRIES)
      const lines = shown.map((entry) => {
        const indent = '  '.repeat(entry.depth)
        const range = entry.line === entry.endLine ? `${entry.line}` : `${entry.line}-${entry.endLine}`
        return `${indent}${range}  ${entry.kind}  ${entry.detail ?? entry.name}`
      })
      if (response.entries.length > shown.length) {
        lines.push(`  …and ${response.entries.length - shown.length} more.`)
      }
      return [
        `${path} — ${response.entries.length} declaration(s). Line ranges are what ` +
          'read_symbol and replace_lines take.',
        ...lines
      ].join('\n')
    }

    case 'text':
      // Numbered through the same helper `replace_lines` and `edit-repair` use, so a
      // symbol read here can be edited by line without the numbers meaning something
      // different between the two tools.
      return numberLines({ lines: response.text.split(/\r?\n/), startLine: response.line })

    case 'locations': {
      if (response.locations.length === 0) return `No occurrences found for that symbol.`
      const shown = response.locations.slice(0, MAX_LISTED_LOCATIONS)
      const lines = shown.map(
        (location) => `  ${location.path}:${location.line}:${location.column}  ${location.text}`
      )
      if (response.locations.length > shown.length) {
        lines.push(`  …and ${response.locations.length - shown.length} more.`)
      }
      return [`${response.locations.length} location(s):`, ...lines].join('\n')
    }

    case 'paths':
      return response.paths.length === 0
        ? `Nothing imports ${path}.`
        : [`${response.paths.length} file(s) import ${path}:`, ...response.paths.map((p) => `  ${p}`)].join('\n')

    case 'ok':
      return 'Nothing to change.'

    case 'edits':
      return null
  }
}

/**
 * Run a write under Pi's file mutation queue for every file it touches.
 *
 * The queue is keyed per path, so a refactor spanning eight files has to hold eight
 * locks. They are taken in sorted order, which is what makes that safe: every caller
 * that needs more than one acquires them in the same sequence, so no two can each hold
 * what the other is waiting for. Pi's own file tools take exactly one lock and never a
 * second, so they cannot deadlock against this either.
 *
 * @param paths - Absolute paths the write will touch
 * @param run - The write
 * @returns Whatever the write returned
 */
async function withFilesLocked<T>(paths: string[], run: () => Promise<T>): Promise<T> {
  const ordered = [...paths].sort()
  const acquire = (index: number): Promise<T> =>
    index >= ordered.length
      ? run()
      : withFileMutationQueue(ordered[index]!, () => acquire(index + 1))
  return acquire(0)
}

/**
 * Parameters for {@link createCodeTools}.
 */
export interface CreateCodeToolsParams {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /**
   * Send a request to the session's language service.
   * @param request - The query
   * @returns The response
   */
  request: (request: ServiceRequest) => Promise<ServiceResponse>
  /**
   * Whether the user has auto-commit enabled.
   * @returns The current setting
   */
  getAutoCommit: () => boolean
}

/**
 * Build the code-intelligence tools for one sub-app.
 * @param params - The app root, the service, and the auto-commit setting
 * @returns Pi tool definitions
 */
export function createCodeTools(params: CreateCodeToolsParams): ToolDefinition[] {
  const { rootPath, request, getAutoCommit } = params

  /**
   * Write the files a refactor produced and commit them together.
   * @param edits - The rewritten files
   * @param description - How the compiler described the change
   * @returns The tool result
   */
  const applyEdits = async (
    edits: Array<{ path: string; text: string }>,
    description: string
  ): Promise<TextToolResult> => {
    const written: string[] = []
    const patches: FilePatch[] = []

    /**
     * Commit whatever was written and describe the outcome.
     * @param message - What to tell the model
     * @returns The tool result
     */
    const finish = async (message: string): Promise<TextToolResult> => {
      const commit = await autoCommitRefactor({
        rootPath,
        relativePaths: written,
        description,
        enabled: getAutoCommit()
      })
      return textResult(message + (commit.note ?? ''), { paths: written, description, patches })
    }

    for (const edit of edits) {
      // The compiler chose this path, not the model, so nothing has confined it. The
      // language service filters its own outputs now; this is the independent check at
      // the point of the write, which is the one that has to be right.
      const absolutePath = resolveLikePi(edit.path, rootPath)
      if (!isWithinRoot(rootPath, absolutePath)) {
        return finish(
          `Error: the compiler wanted to rewrite ${edit.path}, which is outside this app. ` +
            `Nothing further was written; ${written.length} file(s) had already changed.`
        )
      }

      try {
        // Read before writing, so the diff shown to the user is this call's change and
        // not whatever git happens to have. `refactor` cannot use the session's patch
        // recorder: that keys on one `input.path`, and a rename rewrites files the model
        // never named.
        const before = await readFile(absolutePath, 'utf-8').catch(() => '')
        await writeFile(absolutePath, edit.text, 'utf-8')
        written.push(edit.path)
        const patch = buildPatch({ path: edit.path, before, after: edit.text })
        if (patch) patches.push(patch)
      } catch (error) {
        // Commit what did land. Returning without committing would leave those files
        // untracked, and `rollback` is a `git checkout` — it restores tracked files and
        // leaves new ones in place, so they would survive every future rollback.
        return finish(
          `Error: rewrote ${written.length} of ${edits.length} file(s), then could not write ` +
            `${edit.path}. ${(error as Error).message} The app is now in a partly-changed ` +
            'state; check git_status.'
        )
      }
    }

    // The service is holding the pre-refactor snapshot of every file just rewritten.
    await request({ kind: 'invalidate', paths: written })

    // Capped like every other list this module renders. A rename's file count scales
    // with how many places reference the symbol, which no per-file size bound covers —
    // and `refactor` is deliberately outside `TRUNCATABLE_TOOLS`, so nothing downstream
    // would cut it.
    const shown = written.slice(0, MAX_LISTED_FILES)
    const listing = [
      ...shown.map((path) => `  ${path}`),
      ...(written.length > shown.length
        ? [`  …and ${written.length - shown.length} more.`]
        : [])
    ].join('\n')

    return finish(`${description}\n\nFiles changed:\n${listing}`)
  }

  return [
    defineTool({
      name: 'code_intel',
      label: 'Code intelligence',
      description:
        'Ask the TypeScript compiler about the code, instead of searching its text. Symbols are named, never addressed by line and column. Operations: "outline" lists every declaration in a file with its line range — read this before reading a long file; "read_symbol" returns one declaration\'s source instead of the whole file; "definition" finds where a symbol is declared, across files; "references" finds every use of it, across files, and is correct where grep matches comments, strings and unrelated same-named symbols; "hover" gives its resolved type and documentation.',
      parameters: Type.Object({
        operation: StringEnum(
          ['outline', 'read_symbol', 'definition', 'references', 'hover'] as const,
          { description: 'What to ask about the code' }
        ),
        path: Type.String({ description: 'Path to the file, relative to the app root' }),
        symbol: Type.Optional(
          Type.String({
            description:
              'The identifier to resolve, spelled as it appears in the source. Required for every operation except "outline".'
          })
        )
      }),
      execute: async (_toolCallId, { operation, path, symbol }) => {
        if (operation !== 'outline' && !symbol) {
          return textResult(`Error: operation "${operation}" needs a symbol name.`)
        }

        const response = await request(
          operation === 'outline'
            ? { kind: 'outline', path }
            : operation === 'read_symbol'
              ? { kind: 'readSymbol', path, symbol: symbol! }
              : operation === 'definition'
                ? { kind: 'definition', path, symbol: symbol! }
                : operation === 'references'
                  ? { kind: 'references', path, symbol: symbol! }
                  : { kind: 'hover', path, symbol: symbol! }
        )

        // Deliberately not the whole `response`. `details` never reaches the model, but it
        // *is* persisted in Pi's transcript, and a `references` result on a widely-used
        // symbol would be written to disk twice for a payload nothing renders.
        return textResult(renderResponse({ response, path }) ?? 'Nothing to report.', {
          operation,
          path
        })
      }
    }),

    defineTool({
      name: 'refactor',
      label: 'Refactor',
      description:
        'Change code the way the compiler knows how to, rather than by matching text. Operations: "rename" renames a symbol and every use of it across every file in one call — use this instead of editing call sites one by one; "organize_imports" sorts a file\'s imports and drops the unused ones; "apply_fix" applies the compiler\'s own fix for the error on a line, using a line number from the diagnostics reported after a write. Every changed file is committed together.',
      parameters: Type.Object({
        operation: StringEnum(['rename', 'organize_imports', 'apply_fix'] as const, {
          description: 'What to change'
        }),
        path: Type.String({ description: 'Path to the file, relative to the app root' }),
        symbol: Type.Optional(
          Type.String({ description: 'The identifier to rename. Required for "rename".' })
        ),
        newName: Type.Optional(
          Type.String({ description: 'What to rename it to. Required for "rename".' })
        ),
        line: Type.Optional(
          Type.Number({
            description:
              'The 1-indexed line carrying the error to fix, as reported in the diagnostics after a write. Required for "apply_fix".'
          })
        )
      }),
      execute: async (_toolCallId, { operation, path, symbol, newName, line }) => {
        if (operation === 'rename' && (!symbol || !newName)) {
          return textResult('Error: "rename" needs both symbol and newName.')
        }
        if (operation === 'apply_fix' && typeof line !== 'number') {
          return textResult(
            'Error: "apply_fix" needs the line number of the error, from the diagnostics reported after a write.'
          )
        }

        const response = await request(
          operation === 'rename'
            ? { kind: 'rename', path, symbol: symbol!, newName: newName! }
            : operation === 'organize_imports'
              ? { kind: 'organizeImports', path }
              : { kind: 'applyFix', path, line: line! }
        )

        if (response.kind !== 'edits') {
          return textResult(renderResponse({ response, path }) ?? 'Nothing to report.', {
            operation,
            path
          })
        }

        // Through the same queue as Pi's own file tools, so a refactor and a concurrent
        // `write` cannot interleave halfway through each other's files. The compiler
        // computed these edits a moment ago against the text on disk; a write that lands
        // between that query and this lock would make them stale, which is a narrow race
        // and an accepted one — the alternative is holding locks across the whole query.
        return withFilesLocked(
          response.edits.map((edit) => join(rootPath, edit.path)),
          () => applyEdits(response.edits, response.description)
        )
      }
    })
  ]
}

/** Names of the code-intelligence tools, for the session's tool allowlist. */
export const CODE_TOOL_NAMES = ['code_intel', 'refactor'] as const
