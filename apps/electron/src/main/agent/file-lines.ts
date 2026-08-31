/**
 * Line-level file handling shared by `replace_lines` and the edit-repair hook.
 *
 * Both need the same three things and must agree on them exactly: how a file splits
 * into lines, how it joins back without changing its line endings or its final
 * newline, and how a region is numbered when it is quoted to the model. If the numbers
 * the repair hook prints do not mean the same thing as the numbers `replace_lines`
 * accepts, the recovery path this session is built around silently edits the wrong
 * lines.
 *
 * Line numbers here are 1-indexed and inclusive at both ends, matching Pi's `read`
 * tool `offset` and its `[Showing lines X-Y of Z]` footer.
 */

/** A file decomposed into lines, with the details needed to rebuild it byte-for-byte. */
export interface FileText {
  /** The file's lines, without their terminators. */
  lines: string[]
  /** The line ending the file uses. */
  lineEnding: '\n' | '\r\n'
  /** Whether the file ended with a newline, which most tools expect to be preserved. */
  endsWithNewline: boolean
}

/**
 * Split file content into lines without losing how it was terminated.
 *
 * A naive `split('\n')` on `"a\nb\n"` yields a phantom empty third line, which then
 * reappears as a blank line on every rewrite. CRLF is detected from the first
 * occurrence, the way Pi's own `detectLineEnding` does, so a mixed file is normalized
 * to its dominant ending rather than corrupted.
 *
 * @param content - The file's contents
 * @returns The decomposed file
 */
export function parseFileText(content: string): FileText {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const endsWithNewline = /\r?\n$/.test(content)
  // Strip the terminator itself, not just the `\n`: slicing at `lastIndexOf('\n')`
  // leaves a CRLF file's final `\r` glued to the last line.
  const body = endsWithNewline ? content.replace(/\r?\n$/, '') : content

  return {
    lines: body.length === 0 && endsWithNewline ? [''] : body.split(/\r?\n/),
    lineEnding,
    endsWithNewline
  }
}

/**
 * Rebuild file content from its lines.
 * @param text - The decomposed file
 * @returns The content, with the original line ending and final newline restored
 */
export function renderFileText(text: FileText): string {
  const body = text.lines.join(text.lineEnding)
  return text.endsWithNewline ? `${body}${text.lineEnding}` : body
}

/**
 * Parameters for {@link numberLines}.
 */
export interface NumberLinesParams {
  /** The lines to render. */
  lines: string[]
  /** The 1-indexed file line the first entry corresponds to. */
  startLine: number
}

/**
 * Render lines with their file line numbers.
 *
 * Pi's `read` returns no line numbers at all, which is why a model that has to recover
 * from a failed edit has nothing to anchor on. This is the only place anyapp gives it
 * numbers, so the format is deliberately unambiguous: right-aligned number, a space,
 * a pipe, a space, then the line verbatim — including its leading whitespace, which is
 * the thing the model got wrong.
 *
 * @param params - The lines and the number the first one has
 * @returns One `  12 | text` line per input line
 */
export function numberLines(params: NumberLinesParams): string {
  const { lines, startLine } = params
  const width = String(startLine + lines.length - 1).length

  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

/**
 * Normalize a line for comparison that ignores how it is indented.
 *
 * Pi's matcher already tolerates trailing whitespace, line endings, BOM, NFKC
 * differences, smart quotes and exotic spaces. What defeats it is leading indentation
 * and internal whitespace runs — so those are exactly what this collapses, and nothing
 * else. Matching on less would find spurious candidates; matching on more would fail
 * to explain the failure the model actually hit.
 *
 * @param line - One line of text
 * @returns The line with indentation dropped and whitespace runs collapsed
 */
export function normalizeForShapeMatch(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}
