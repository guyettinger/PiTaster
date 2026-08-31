/**
 * Line-addressed file editing, as the recovery path when exact-text editing fails.
 *
 * Pi's `edit` matches on text, and its matcher tolerates trailing whitespace, line
 * endings, BOM, smart quotes and exotic spaces — but not leading indentation. A small
 * local model reproducing an indented TypeScript block gets the indentation wrong,
 * reads `The old text must match exactly including all whitespace and newlines`, and
 * retries with the same indentation. There is no `replace_all` and uniqueness is a hard
 * error, so shrinking the anchor to avoid the mismatch produces `Found N occurrences`
 * instead.
 *
 * `replace_lines` takes line numbers, so it cannot fail that way at all. It exists as
 * the second attempt rather than the first: `agent/edit-repair.ts` quotes the real
 * region back with numbers when an `edit` fails, and those are the numbers this tool
 * consumes. That pairing is why no numbered-`read` tool was added — the numbers arrive
 * attached to the failure that needs them, at no cost to a session that never fails an
 * edit.
 *
 * Confinement is not here. Like every path-bearing tool this is gated by
 * `checkConfinement` in `agent/permission-gate.ts`, which resolves `path` the way Pi
 * would and refuses anything outside the sub-app root before `execute` is reached.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { numberLines, parseFileText, renderFileText } from './file-lines'
import { resolveLikePi } from './permission-gate'

/**
 * Lines of context shown around a replacement in the tool's result.
 *
 * Enough for the model to see that its edit landed where it intended, and small enough
 * that a long session of line edits does not fill the window with echoes of itself.
 */
const RESULT_CONTEXT_LINES = 3

/**
 * A Pi tool result carrying one block of text.
 */
interface TextToolResult {
  /** The result content. */
  content: Array<{ type: 'text'; text: string }>
  /** Structured details; unused here, but Pi's shape requires the field. */
  details: Record<string, never>
}

/**
 * Wrap text as a tool result.
 * @param text - The message for the model
 * @returns A Pi tool result
 */
function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }], details: {} }
}

/**
 * Parameters for {@link replaceLinesInFile}.
 */
export interface ReplaceLinesParams {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Path to the file, as the model gave it. */
  path: string
  /** First line to replace, 1-indexed and inclusive. */
  startLine: number
  /** Last line to replace, 1-indexed and inclusive. */
  endLine: number
  /** Text to put in their place. Empty deletes the range. */
  newText: string
}

/**
 * Replace a range of lines in a file.
 *
 * Split out from the tool so it can be tested directly: Pi's `execute` takes five
 * arguments, two of which are runtime objects a test would have to fake, and none of
 * which this logic uses.
 *
 * Failures come back as text rather than thrown, matching the version tools — the model
 * always receives a usable result and can recover from it.
 *
 * @param params - The file, the range, and the replacement
 * @returns The message for the model
 */
export async function replaceLinesInFile(params: ReplaceLinesParams): Promise<string> {
  const { rootPath, path, startLine, endLine, newText } = params
  // `resolveLikePi`, not a bare `resolve`. The gate checked confinement against that
  // resolution — it strips a leading `@`, expands `~`, and normalizes unicode spaces —
  // so resolving differently here would write to a path the gate never examined. In this
  // tool's case the difference is fail-safe (the gate's version is the more escaping of
  // the two, so anything it allows is in-root either way), but "allowed src/App.tsx and
  // wrote @src/App.tsx" is still the wrong file.
  const absolutePath = resolveLikePi(path, rootPath)

  let original: string
  try {
    original = await readFile(absolutePath, 'utf-8')
  } catch (error) {
    return `Error: could not read ${path}. ${(error as Error).message}`
  }

  const file = parseFileText(original)
  const total = file.lines.length

  // Every rejection names the file's real line count. A model that guessed the range
  // needs that number to guess better, and without it the obvious next move is another
  // guess at the same wrong scale.
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return `Error: startLine and endLine must be whole numbers. ${path} has ${total} lines.`
  }
  if (startLine < 1 || endLine < startLine) {
    return (
      `Error: invalid range ${startLine}-${endLine}. startLine must be at least 1 and endLine ` +
      `must not be before it. ${path} has ${total} lines.`
    )
  }
  if (endLine > total) {
    return (
      `Error: ${path} has ${total} lines, so lines ${startLine}-${endLine} do not all exist. ` +
      'Read the file and retry with a range inside it.'
    )
  }

  // An empty `newText` means delete. Splitting it would insert one blank line, which is
  // a different edit from the one the description promises.
  const replacement = newText.length === 0 ? [] : newText.split(/\r?\n/)
  const updated: typeof file = {
    ...file,
    lines: [...file.lines.slice(0, startLine - 1), ...replacement, ...file.lines.slice(endLine)]
  }

  const rendered = renderFileText(updated)
  if (rendered === original) {
    return `No change: lines ${startLine}-${endLine} of ${path} already read exactly as the replacement text.`
  }

  try {
    await writeFile(absolutePath, rendered, 'utf-8')
  } catch (error) {
    return `Error: could not write ${path}. ${(error as Error).message}`
  }

  // Report the result with numbers, because they have all just moved: replacing 3 lines
  // with 5 shifts everything below by 2, and a model working from its previous numbers
  // would then edit the wrong place.
  const from = Math.max(1, startLine - RESULT_CONTEXT_LINES)
  const to = Math.min(
    updated.lines.length,
    startLine - 1 + replacement.length + RESULT_CONTEXT_LINES
  )
  const excerpt = numberLines({ lines: updated.lines.slice(from - 1, to), startLine: from })
  const removed = endLine - startLine + 1

  return (
    `Replaced lines ${startLine}-${endLine} of ${path} (${removed} line(s) removed, ` +
    `${replacement.length} added). The file now has ${updated.lines.length} lines, so line ` +
    `numbers below the edit have shifted.\n\n${excerpt}`
  )
}

/**
 * Parameters for {@link createFileTools}.
 */
export interface CreateFileToolsParams {
  /** Absolute path to the sub-app root, used to resolve the model's `path`. */
  rootPath: string
}

/**
 * Build the line-addressed editing tools for one sub-app.
 * @param params - The sub-app root
 * @returns Pi tool definitions
 */
export function createFileTools(params: CreateFileToolsParams): ToolDefinition[] {
  const { rootPath } = params

  return [
    defineTool({
      name: 'replace_lines',
      label: 'Replace lines',
      description:
        'Replace a range of lines in a file by line number, 1-indexed and inclusive of both ends. Use this when an `edit` has failed because the exact text could not be matched: the failure message quotes the region back with line numbers, and those are the numbers to pass here. Pass an empty newText to delete the range.',
      parameters: Type.Object({
        path: Type.String({ description: 'Path to the file to edit (relative to the app root)' }),
        startLine: Type.Number({ description: 'First line to replace, 1-indexed and inclusive' }),
        endLine: Type.Number({
          description:
            'Last line to replace, 1-indexed and inclusive. Equal to startLine to replace one line.'
        }),
        newText: Type.String({
          description:
            'Text to put in place of those lines, without a trailing newline. May span several lines. Empty deletes the range.'
        })
      }),
      execute: async (_toolCallId, { path, startLine, endLine, newText }) =>
        textResult(await replaceLinesInFile({ rootPath, path, startLine, endLine, newText }))
    })
  ]
}

/** Names of the line-addressed file tools, for the session's tool allowlist. */
export const FILE_TOOL_NAMES = ['replace_lines'] as const
