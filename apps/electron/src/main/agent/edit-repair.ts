/**
 * Turns a failed `edit` into a next attempt that can succeed.
 *
 * Pi's edit failure is a dead end for a small local model. `Could not find the exact
 * text in src/App.tsx. The old text must match exactly including all whitespace and
 * newlines.` names no line, quotes no text, and — worse — misdescribes its own cause.
 * Pi's matcher already tolerates trailing whitespace, CRLF, BOM, NFKC differences,
 * smart quotes, Unicode dashes and exotic spaces (`normalizeForFuzzyMatch`,
 * `dist/core/tools/edit-diff.js:31-50`). What actually defeats it is **leading
 * indentation**, internal whitespace runs, and blank-line counts. Told "all
 * whitespace", the model retries with the same indentation and fails identically.
 *
 * So this hook reads the file, finds where the text the model was aiming at really is,
 * and quotes that region back with line numbers — the exact bytes, indentation
 * included. The next attempt is then a copy rather than a guess, and the line numbers
 * make `replace_lines` available as a route that cannot fail this way at all.
 *
 * `agent/loop-guard.ts` cannot cover this. It blocks a third *byte-identical* call, and
 * a model re-guessing whitespace produces a different call every time. The consecutive
 * per-path failure count here is what bounds that, and it escalates rather than
 * blocking: refusing an edit outright would leave the model with no way to change the
 * file at all.
 *
 * The result stays `isError: true`. The edit did fail, and reporting otherwise would
 * make the model believe a change landed that did not.
 */

import { readFile } from 'node:fs/promises'
import { normalizeForShapeMatch, numberLines, parseFileText } from './file-lines'
import { resolveLikePi } from './permission-gate'

/**
 * Consecutive failed edits on one path before the model is told to change approach.
 *
 * Two is an ordinary miss followed by a corrected retry — the case this whole module
 * exists to make succeed. Three means the corrections are not converging.
 */
const FAILURE_ESCALATION_LIMIT = 3

/** Lines of a quoted region, whatever the token budget allows. */
const MAX_QUOTE_LINES = 40

/** Rough characters per token, matching `agent/context-trim.ts`. */
const CHARS_PER_TOKEN = 4

/** Occurrences listed for a duplicate-match failure before the list is summarized. */
const MAX_OCCURRENCES_LISTED = 5

/** How Pi's edit tool failed, as far as the message can be classified. */
type FailureKind = 'notFound' | 'duplicate' | 'noChange' | 'overlap' | 'empty' | 'other'

/**
 * One `edits[]` entry, as Pi's schema defines it.
 */
interface EditEntry {
  /** The text the model expected to find. */
  oldText: string
  /** What it wanted in that place. */
  newText: string
}

/**
 * A line of the file, paired with the number it has.
 */
interface IndexedLine {
  /** The line's text, normalized for shape comparison. */
  normalized: string
  /** The line's 1-indexed number in the file. */
  lineNumber: number
}

/**
 * Classify Pi's failure message.
 *
 * Matched on the distinctive phrase rather than the whole sentence, because the
 * single-edit and multi-edit branches word the same failure differently — "The old
 * text" against "The oldText" (`dist/core/tools/edit-diff.js:182-205`).
 *
 * @param message - The tool result text
 * @returns Which failure it is
 */
export function classifyEditFailure(message: string): FailureKind {
  if (/Could not find (?:the exact text|edits\[\d+\])/.test(message)) return 'notFound'
  if (/Found \d+ occurrences/.test(message)) return 'duplicate'
  if (/No changes made to/.test(message)) return 'noChange'
  if (/overlap in/.test(message)) return 'overlap'
  if (/oldText must not be empty/.test(message)) return 'empty'
  return 'other'
}

/**
 * Read the index of the `edits[]` entry a message blames, when it names one.
 * @param message - The tool result text
 * @returns The index, or 0 when the message is the single-edit wording
 */
function failedEditIndex(message: string): number {
  const match = /edits\[(\d+)\]/.exec(message)
  return match ? Number(match[1]) : 0
}

/**
 * Read the `edits[]` array off a tool input, tolerating Pi's legacy shapes.
 *
 * `prepareEditArguments` (`dist/core/tools/edit.js:46-76`) migrates a JSON-string
 * `edits`, a bare `{oldText,newText}` object, and legacy top-level fields into the
 * array before validation. That normalization happens inside the tool, so what an
 * extension observes is not guaranteed to have been through it.
 *
 * @param input - The tool call arguments
 * @returns The edits, or an empty array when none can be read
 */
function readEdits(input: Record<string, unknown>): EditEntry[] {
  const isEntry = (value: unknown): value is EditEntry =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as EditEntry).oldText === 'string' &&
    typeof (value as EditEntry).newText === 'string'

  const raw = input.edits
  if (Array.isArray(raw)) return raw.filter(isEntry)
  if (isEntry(raw)) return [raw]
  if (isEntry(input)) return [input]
  return []
}

/**
 * Drop blank lines and normalize the rest, keeping each line's real number.
 *
 * Blank lines are dropped on both sides of the comparison because a differing count of
 * them is one of the three things that defeats Pi's matcher, and a model that added or
 * lost one still meant the same region.
 *
 * @param lines - The lines to index
 * @param startLine - The 1-indexed number of the first line
 * @returns The non-blank lines, normalized, with their numbers
 */
function indexNonBlank(lines: string[], startLine: number): IndexedLine[] {
  const indexed: IndexedLine[] = []
  for (const [offset, line] of lines.entries()) {
    const normalized = normalizeForShapeMatch(line)
    if (normalized.length === 0) continue
    indexed.push({ normalized, lineNumber: startLine + offset })
  }
  return indexed
}

/**
 * Find every place the needle's shape occurs in the file.
 *
 * Comparison is indentation-insensitive and blank-line-insensitive by construction —
 * both sides went through {@link indexNonBlank} — so this finds the region the model
 * was aiming at even though Pi's exact matcher could not.
 *
 * @param haystack - The file's non-blank lines
 * @param needle - The sought text's non-blank lines
 * @returns The first and last file line of each match
 */
function findShapeMatches(
  haystack: IndexedLine[],
  needle: IndexedLine[]
): Array<{ startLine: number; endLine: number }> {
  if (needle.length === 0 || haystack.length < needle.length) return []

  const matches: Array<{ startLine: number; endLine: number }> = []
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset].normalized !== needle[offset].normalized) {
        matched = false
        break
      }
    }
    if (matched) {
      matches.push({
        startLine: haystack[start].lineNumber,
        endLine: haystack[start + needle.length - 1].lineNumber
      })
    }
  }
  return matches
}

/**
 * Parameters for {@link quoteRegion}.
 */
interface QuoteRegionParams {
  /** The file's lines. */
  lines: string[]
  /** First line of the region, 1-indexed. */
  startLine: number
  /** Last line of the region, 1-indexed. */
  endLine: number
  /** Characters the quote may occupy. */
  maxChars: number
}

/**
 * Quote a region of the file with line numbers, within a budget.
 *
 * The budget is not optional politeness: this text is a tool result on a window as
 * small as 32k, and an unbounded quote of a large region would cost more than the
 * failure it explains.
 *
 * @param params - The file, the region, and the character budget
 * @returns The numbered region, truncated with a note when it does not fit
 */
function quoteRegion(params: QuoteRegionParams): string {
  const { lines, startLine, endLine, maxChars } = params
  const region = lines.slice(startLine - 1, endLine)

  let kept = region.slice(0, MAX_QUOTE_LINES)
  let truncated = kept.length < region.length

  while (kept.length > 1 && numberLines({ lines: kept, startLine }).length > maxChars) {
    kept = kept.slice(0, -1)
    truncated = true
  }

  const body = numberLines({ lines: kept, startLine })
  if (!truncated) return body

  const lastShown = startLine + kept.length - 1
  return `${body}\n… region continues to line ${endLine}; re-read from offset ${lastShown + 1} for the rest.`
}

/**
 * Name the way the model's text differed from what is really there.
 * @param expected - The `oldText` the model supplied
 * @param actual - The file's text for the region that matched its shape
 * @returns A short phrase for the failure message
 */
function describeDifference(expected: string, actual: string): string {
  const expectedLines = expected.split(/\r?\n/)
  const actualLines = actual.split(/\r?\n/)

  const indentOf = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? ''
  const firstExpected = expectedLines.find((line) => line.trim().length > 0) ?? ''
  const firstActual = actualLines.find((line) => line.trim().length > 0) ?? ''

  if (indentOf(firstExpected) !== indentOf(firstActual)) {
    return 'the indentation differs — your oldText did not reproduce the leading whitespace'
  }
  if (expectedLines.length !== actualLines.length) {
    return 'the number of blank lines differs'
  }
  return 'the spacing inside one or more lines differs'
}

/**
 * The message and the streak state produced for one failed edit.
 */
export interface EditRepairOutcome {
  /** Replacement text for the tool result, or undefined to leave it alone. */
  text?: string
}

/**
 * Parameters for {@link createEditRepair}.
 */
export interface CreateEditRepairParams {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Tokens the quoted region may occupy. */
  maxQuoteTokens: number
  /** File reader, injectable so the repair can be tested without a filesystem. */
  readTextFile?: (absolutePath: string) => Promise<string>
}

/**
 * Parameters for {@link EditRepair.repair}.
 */
export interface RepairParams {
  /** The arguments the `edit` call was made with. */
  input: Record<string, unknown>
  /** The tool result text Pi produced. */
  resultText: string
  /** Whether Pi reported failure. */
  isError: boolean
}

/**
 * Rewrites failed edits into actionable failures, and tracks how often they repeat.
 */
export interface EditRepair {
  /**
   * Diagnose one `edit` result.
   * @param params - The call's arguments and its result
   * @returns Replacement text, or an empty outcome to leave the result unchanged
   */
  repair: (params: RepairParams) => Promise<EditRepairOutcome>
  /** Forget every streak. Call when a new prompt begins. */
  reset: () => void
}

/**
 * Create the edit-repair tracker for one session.
 * @param params - The app root, the quote budget, and an optional reader
 * @returns The tracker
 */
export function createEditRepair(params: CreateEditRepairParams): EditRepair {
  const { rootPath, maxQuoteTokens } = params
  const readTextFile =
    params.readTextFile ?? ((absolutePath: string) => readFile(absolutePath, 'utf-8'))

  /** Consecutive failures per path, reset by a success or a new prompt. */
  const failures = new Map<string, number>()
  const maxChars = Math.max(200, maxQuoteTokens * CHARS_PER_TOKEN)

  const escalation = (path: string, count: number): string =>
    count < FAILURE_ESCALATION_LIMIT
      ? ''
      : `\n\nThis is failure ${count} in a row on ${path}. Stop adjusting the text: re-read the ` +
        'file, then use `replace_lines` with the line numbers above, or rewrite the whole file ' +
        'with `write`.'

  return {
    repair: async ({ input, resultText, isError }): Promise<EditRepairOutcome> => {
      const path = typeof input.path === 'string' ? input.path : undefined
      if (!path) return {}

      if (!isError) {
        failures.delete(path)
        return {}
      }

      const count = (failures.get(path) ?? 0) + 1
      failures.set(path, count)

      const kind = classifyEditFailure(resultText)
      if (kind === 'other') return {}

      if (kind === 'noChange') {
        return {
          text:
            `${resultText}\n\nThe file already contains the replacement text, so there was nothing ` +
            `to change. Read ${path} and confirm the change is not already in place before editing ` +
            `again.${escalation(path, count)}`
        }
      }
      if (kind === 'overlap' || kind === 'empty') {
        return {
          text:
            `${resultText}\n\nEach entry in edits[] is matched against the original file, so two ` +
            'entries cannot touch the same lines. Merge them into one entry covering the whole ' +
            `region.${escalation(path, count)}`
        }
      }

      const edits = readEdits(input)
      const edit = edits[failedEditIndex(resultText)] ?? edits[0]
      if (!edit) return {}

      let content: string
      try {
        // The same resolution the gate and Pi's own tools use, so the file quoted back
        // is the file the edit was aimed at. This path was already allowed by the gate —
        // the hook runs after it — so this is about quoting the right file, not access.
        content = await readTextFile(resolveLikePi(path, rootPath))
      } catch {
        // The file is unreadable, which is a different failure from a text mismatch and
        // Pi's own message already covers it.
        return {}
      }

      const file = parseFileText(content)
      const haystack = indexNonBlank(file.lines, 1)
      const needle = indexNonBlank(edit.oldText.split(/\r?\n/), 1)
      const matches = findShapeMatches(haystack, needle)

      if (kind === 'duplicate') {
        const listed = matches.slice(0, MAX_OCCURRENCES_LISTED)
        const where =
          listed.length === 0
            ? 'Pi counts occurrences after normalizing whitespace, so the copies may not look identical.'
            : `It appears at line${listed.length === 1 ? '' : 's'} ` +
              `${listed.map((match) => match.startLine).join(', ')}` +
              `${matches.length > listed.length ? `, and ${matches.length - listed.length} more` : ''}.`

        return {
          text:
            `${resultText}\n\n${where} Either extend oldText with surrounding lines until only one ` +
            'place matches, or use `replace_lines` with the line range you meant.' +
            escalation(path, count)
        }
      }

      // notFound.
      if (matches.length === 1) {
        const { startLine, endLine } = matches[0]
        const actual = file.lines.slice(startLine - 1, endLine).join('\n')
        return {
          text:
            `${resultText}\n\nThat text is in ${path} at lines ${startLine}-${endLine}, but ` +
            `${describeDifference(edit.oldText, actual)}. Here is the region exactly as the file ` +
            'has it — copy oldText from this, including the leading whitespace, or call ' +
            `\`replace_lines\` with startLine=${startLine} and endLine=${endLine}:\n\n` +
            `${quoteRegion({ lines: file.lines, startLine, endLine, maxChars })}` +
            escalation(path, count)
        }
      }

      if (matches.length > 1) {
        return {
          text:
            `${resultText}\n\nIgnoring indentation, that text appears at lines ` +
            `${matches.slice(0, MAX_OCCURRENCES_LISTED).map((match) => match.startLine).join(', ')}. ` +
            'Add surrounding lines to oldText until one place is unique, or use `replace_lines`.' +
            escalation(path, count)
        }
      }

      return {
        text:
          `${resultText}\n\nNo part of ${path} matches that text, even ignoring indentation and ` +
          `blank lines — the file has ${file.lines.length} lines. It may have changed since you ` +
          'last read it, or the text may be in a different file. Read it again before editing.' +
          escalation(path, count)
      }
    },

    reset: (): void => {
      failures.clear()
    }
  }
}
