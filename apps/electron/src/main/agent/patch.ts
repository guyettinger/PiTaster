/**
 * What a write actually changed, as a diff for the user.
 *
 * Key Lime Pi's safety story is that every write is auto-committed so any change can be
 * rolled back. Until now the UI showed a write as its path and `JSON.stringify(input)`,
 * which means you could roll a change back without ever having seen it. This is what
 * puts the change itself in front of the person approving or reviewing it.
 *
 * **It costs nothing in the context window.** The patch rides on the tool result's
 * `details`, which Pi keeps out of what it sends the model. So the diff can be as
 * generous as the UI wants without competing with the code the agent is reasoning about
 * — the caps below are about what a person can read in a chat bubble, not about tokens.
 *
 * The before-text is captured in the `tool_call` hook rather than reconstructed from git
 * afterwards, so a patch appears whether or not auto-commit is on.
 */

import { readFile } from 'node:fs/promises'
import { createTwoFilesPatch } from 'diff'
import type { FilePatch } from '@keylimepi/core'
import { resolveLikePi } from './permission-gate'

/**
 * Largest file the recorder will hold a copy of.
 *
 * A diff of a bundled or generated file is not something anyone reads, and stashing one
 * per in-flight tool call is memory the main process has no reason to spend.
 */
const MAX_TRACKED_BYTES = 512 * 1024

/** Longest diff kept, in lines. Past this the bubble is a wall, not a summary. */
const MAX_PATCH_LINES = 400

/** Lines of unchanged context on each side of a change. */
const CONTEXT_LINES = 3

/**
 * Build a unified diff between two versions of a file.
 *
 * @param params - The path and the two versions
 * @returns The patch, or `null` when nothing changed
 */
export function buildPatch(params: {
  /** Path relative to the app root, as the UI should label it. */
  path: string
  /** The file's contents before the write. Empty for a new file. */
  before: string
  /** The file's contents after the write. */
  after: string
}): FilePatch | null {
  const { path, before, after } = params
  if (before === after) return null

  const full = createTwoFilesPatch(path, path, before, after, '', '', {
    context: CONTEXT_LINES
  })

  // `createTwoFilesPatch` leads with an `Index:` line and the `---`/`+++` pair, which
  // repeat the filename the UI is already showing above the diff.
  const body = full.split('\n').slice(4)

  const added = body.filter((line) => line.startsWith('+')).length
  const removed = body.filter((line) => line.startsWith('-')).length

  const truncated = body.length > MAX_PATCH_LINES
  const shown = truncated
    ? [...body.slice(0, MAX_PATCH_LINES), `… ${body.length - MAX_PATCH_LINES} more lines`]
    : body

  return { path, patch: shown.join('\n').trimEnd(), added, removed, truncated }
}

/** Captures a file before a write and diffs it afterwards. */
export interface PatchRecorder {
  /**
   * Remember a file's contents before a tool writes to it.
   * @param params - The call's id and the path it will write
   */
  record: (params: { toolCallId: string; path: string }) => Promise<void>
  /**
   * Diff a file against what {@link PatchRecorder.record} remembered.
   * @param params - The call's id and the path it wrote
   * @returns The patch, or `null` when nothing was recorded or nothing changed
   */
  complete: (params: { toolCallId: string; path: string }) => Promise<FilePatch | null>
  /**
   * Drop a recording for a call that never completed.
   * @param toolCallId - The call to forget
   */
  forget: (toolCallId: string) => void
}

/**
 * Build a recorder for one session.
 *
 * @param params - The sub-app root, for resolving the model's paths
 * @returns The recorder
 */
export function createPatchRecorder(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
}): PatchRecorder {
  const { rootPath } = params
  const before = new Map<string, string>()

  /**
   * Read a file, treating a missing one as empty.
   * @param absolutePath - The file to read
   * @returns Its contents, or `null` when it is too large to track
   */
  const readTracked = async (absolutePath: string): Promise<string | null> => {
    try {
      const text = await readFile(absolutePath, 'utf-8')
      return text.length > MAX_TRACKED_BYTES ? null : text
    } catch {
      // A tool writing a file that does not exist yet is the ordinary case for `write`,
      // and its diff against an empty string is exactly the right rendering: all added.
      return ''
    }
  }

  return {
    record: async ({ toolCallId, path }) => {
      const text = await readTracked(resolveLikePi(path, rootPath))
      if (text === null) return
      before.set(toolCallId, text)
    },

    complete: async ({ toolCallId, path }) => {
      const previous = before.get(toolCallId)
      before.delete(toolCallId)
      if (previous === undefined) return null

      const after = await readTracked(resolveLikePi(path, rootPath))
      if (after === null) return null

      return buildPatch({ path, before: previous, after })
    },

    forget: (toolCallId: string) => {
      before.delete(toolCallId)
    }
  }
}

/**
 * What a write *would* change, computed before it runs.
 *
 * This is for the approval prompt. In `default` mode the user is asked to approve a
 * write knowing only its path, which is the one place in Key Lime Pi where a person is asked
 * to take responsibility for something they cannot see.
 *
 * A preview must be **accurate or absent** — a wrong one is worse than none, because it
 * would be approved on. So each tool is previewed only where the result is deducible:
 *
 * - `write` carries the whole new file, so the diff is exact.
 * - `replace_lines` is Key Lime Pi's own and purely positional, so the diff is exact.
 * - `edit` is Pi's, and its matcher falls back to a fuzzy comparison that tolerates
 *   line endings, BOM, smart quotes and exotic spaces. Reimplementing that here to draw
 *   a picture would mean two matchers that must agree forever. So the preview applies
 *   each `oldText` as a plain exact, unique match — a strict subset of what Pi accepts —
 *   and returns nothing at all if any of them does not land. When it does return
 *   something, Pi will do the same thing.
 *
 * @param params - The app root and the pending call
 * @returns The patches the call would produce, or an empty array when it cannot be known
 */
export async function previewPatch(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** The tool about to run. */
  toolName: string
  /** Its arguments. */
  input: Record<string, unknown>
}): Promise<FilePatch[]> {
  const { rootPath, toolName, input } = params
  const path = input.path
  if (typeof path !== 'string') return []

  let before: string
  try {
    before = await readFile(resolveLikePi(path, rootPath), 'utf-8')
  } catch {
    before = ''
  }
  if (before.length > MAX_TRACKED_BYTES) return []

  const after = projectWrite({ toolName, input, before })
  if (after === null) return []

  const patch = buildPatch({ path, before, after })
  return patch ? [patch] : []
}

/**
 * Work out a file's contents after a pending write.
 *
 * @param params - The tool, its arguments, and the file as it stands
 * @returns The projected contents, or `null` when they cannot be known exactly
 */
function projectWrite(params: {
  /** The tool about to run. */
  toolName: string
  /** Its arguments. */
  input: Record<string, unknown>
  /** The file's current contents. */
  before: string
}): string | null {
  const { toolName, input, before } = params

  if (toolName === 'write') {
    return typeof input.content === 'string' ? input.content : null
  }

  if (toolName === 'replace_lines') {
    const { startLine, endLine, newText } = input
    if (
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      typeof newText !== 'string'
    ) {
      return null
    }
    const lines = before.split('\n')
    const from = startLine as number
    const to = endLine as number
    if (from < 1 || to < from || to > lines.length) return null
    const replacement = newText.length === 0 ? [] : newText.split(/\r?\n/)
    return [...lines.slice(0, from - 1), ...replacement, ...lines.slice(to)].join('\n')
  }

  if (toolName === 'edit') {
    const edits = input.edits
    if (!Array.isArray(edits) || edits.length === 0) return null

    let projected = before
    for (const entry of edits) {
      const { oldText, newText } = (entry ?? {}) as { oldText?: unknown; newText?: unknown }
      if (typeof oldText !== 'string' || typeof newText !== 'string') return null

      // Pi resolves every `oldText` against the *original* file and requires each to be
      // unique, so uniqueness is checked against `before` and the substitution is applied
      // to the running text. A second occurrence means Pi will refuse the edit anyway.
      const first = before.indexOf(oldText)
      if (first === -1 || before.indexOf(oldText, first + 1) !== -1) return null

      const at = projected.indexOf(oldText)
      if (at === -1) return null
      projected = projected.slice(0, at) + newText + projected.slice(at + oldText.length)
    }
    return projected
  }

  return null
}
