/**
 * Compiler errors, attached to the tool result of the write that caused them.
 *
 * This is the highest-value thing anyapp can do for a local model and it costs nothing
 * in the tool manifest, which is why it is a hook rather than a tool. `bash` is
 * deliberately absent from `FILE_TOOLS` in `permission-gate.ts`, so in `acceptEdits` —
 * the mode this app is built to be run in — the model cannot run `tsc` without stopping
 * to ask. It writes TypeScript and finds out whether it compiles when a human runs the
 * app. Putting the errors in the result of the write closes that loop with no schema
 * tokens spent and no decision for the model to get wrong.
 *
 * **The budget is enforced here, at the source.** `edit` and `write` are absent from
 * `TRUNCATABLE_TOOLS` in `context-trim.ts`, and deliberately so — an agent that cannot
 * see what it just did repeats it. That means anything appended to their results lives
 * in the window for the rest of the session, and nothing downstream will cut it. A file
 * with sixty errors has to be reported in a handful of lines by this module or not at
 * all.
 */

import type { Diagnostic, ServiceResponse } from './ts-service/protocol'

/**
 * Errors quoted in full before the rest become a count.
 *
 * Small on purpose. A model fixes errors one or two at a time, and the first error in a
 * file is very often the cause of the rest — so the marginal value of the eighth line
 * is low and its cost is permanent.
 */
const MAX_QUOTED_ERRORS = 8

/** Longest single error message kept. */
const MAX_MESSAGE_LENGTH = 240

/** Importing files named in the cascade line before the rest become a count. */
const MAX_NAMED_DEPENDENTS = 5

/**
 * Something that can answer language-service requests.
 *
 * Narrower than the full client so tests can supply a function instead of a process.
 */
export interface DiagnosticsSource {
  /**
   * Ask the service something.
   * @param request - The query
   * @returns The response
   */
  request: (
    request:
      | { kind: 'invalidate'; paths: string[] }
      | { kind: 'diagnostics'; path: string }
      | { kind: 'referencingFiles'; path: string }
  ) => Promise<ServiceResponse>
}

/**
 * Render diagnostics as the block appended to a tool result.
 *
 * Separated from the fetching so the shape of the message — which is what the model
 * actually consumes — can be tested without a compiler.
 *
 * @param params - The file, its errors, and any dependents that newly broke
 * @returns The block to append, or `null` when there is nothing worth saying
 */
export function formatDiagnosticsNote(params: {
  /** Path the model used, relative to the app root. */
  path: string
  /** Errors in that file. */
  errors: Diagnostic[]
  /** Files that import it and have broken since the last check. */
  brokenDependents: string[]
}): string | null {
  const { path, errors, brokenDependents } = params

  if (errors.length === 0 && brokenDependents.length === 0) return null

  const lines: string[] = []

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_QUOTED_ERRORS)
    lines.push(
      `${errors.length} TypeScript error${errors.length === 1 ? '' : 's'} in ${path}:`,
      ...shown.map((error) => {
        const message =
          error.message.length > MAX_MESSAGE_LENGTH
            ? `${error.message.slice(0, MAX_MESSAGE_LENGTH)}…`
            : error.message
        return `  ${error.line}:${error.column}  ${message}`
      })
    )
    if (errors.length > shown.length) {
      lines.push(`  …and ${errors.length - shown.length} more.`)
    }
    // Naming the recovery explicitly, because `apply_fix` takes the line number these
    // lines just printed and a model will not infer that pairing on its own.
    lines.push(
      'Fix these before continuing. `refactor` with operation "apply_fix" and one of the ' +
        "line numbers above will apply the compiler's own fix where it has one."
    )
  }

  if (brokenDependents.length > 0) {
    const named = brokenDependents.slice(0, MAX_NAMED_DEPENDENTS)
    const rest = brokenDependents.length - named.length
    lines.push(
      `This change also broke ${named.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}. ` +
        'Their errors are not listed here; read the files or check them with code_intel.'
    )
  }

  return lines.join('\n')
}

/** Watches a sub-app for errors introduced by the agent's writes. */
export interface DiagnosticsNotifier {
  /**
   * Check a file the agent just wrote.
   * @param path - The path the model used, relative to the app root
   * @returns The block to append to the tool result, or `null`
   */
  check: (path: string) => Promise<string | null>
}

/**
 * Build the notifier for one session.
 *
 * @param params - Where to send language-service requests
 * @returns The notifier
 */
export function createDiagnosticsNotifier(params: {
  /** The session's language service. */
  source: DiagnosticsSource
}): DiagnosticsNotifier {
  const { source } = params

  /**
   * Error counts for files this session has already looked at.
   *
   * The point of recording them is that "this edit broke another file" is only worth
   * saying when it is true. A file that was already failing before the agent touched
   * anything is not news, and naming it every time would train the model to ignore the
   * line. A file absent from this map has never been checked, so nothing is claimed
   * about it — the first edit reports no cascade, and every edit after that can.
   */
  const errorCounts = new Map<string, number>()

  /**
   * Errors for one file.
   * @param path - Path relative to the app root
   * @returns The errors, or `null` when the service could not answer
   */
  const errorsFor = async (path: string): Promise<Diagnostic[] | null> => {
    const response = await source.request({ kind: 'diagnostics', path })
    if (response.kind !== 'diagnostics') return null
    return response.diagnostics.filter((diagnostic) => diagnostic.category === 'error')
  }

  return {
    check: async (path: string) => {
      // The service reads from disk, and the write that triggered this has already
      // landed — but the program is still holding the previous snapshot, so without
      // this the diagnostics would describe the file as it was before the edit.
      await source.request({ kind: 'invalidate', paths: [path] })

      const errors = await errorsFor(path)
      if (errors === null) return null
      errorCounts.set(path, errors.length)

      const importers = await source.request({ kind: 'referencingFiles', path })
      const brokenDependents: string[] = []
      if (importers.kind === 'paths') {
        for (const dependent of importers.paths) {
          const previous = errorCounts.get(dependent)
          const current = await errorsFor(dependent)
          if (current === null) continue
          errorCounts.set(dependent, current.length)
          if (previous === 0 && current.length > 0) brokenDependents.push(dependent)
        }
      }

      return formatDiagnosticsNote({ path, errors, brokenDependents })
    }
  }
}
