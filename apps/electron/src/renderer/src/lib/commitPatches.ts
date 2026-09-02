/**
 * Turning a commit's `FileDiff[]` into the patches the diff view renders.
 *
 * `VersionManager.diff` answers with whole before and after contents per file, which is
 * the right shape for a git layer and the wrong one for a UI — rendering it meant either
 * showing two columns of the entire file, which is what the old `DiffViewer` did, or
 * computing the change. This computes the change.
 *
 * It runs in the renderer rather than the main process because the diff library is
 * already in the renderer bundle for the transcript's patches, and moving this to main
 * would mean a second copy of the same computation behind an IPC round trip.
 */

import { createTwoFilesPatch } from 'diff'
import type { FileDiff, FilePatch } from '@anyapp/core'

/** Longest diff kept, in lines, matching the cap the agent's patches use. */
const MAX_PATCH_LINES = 400

/** Lines of unchanged context on each side of a change. */
const CONTEXT_LINES = 3

/**
 * Convert one commit's file diffs into renderable patches.
 *
 * @param diffs - The diffs as the version manager reported them
 * @returns One patch per file that actually changed
 */
export function buildPatchFromDiff(diffs: FileDiff[]): FilePatch[] {
  const patches: FilePatch[] = []

  for (const diff of diffs) {
    const before = diff.oldContent ?? ''
    const after = diff.newContent ?? ''
    if (before === after) continue

    const body = createTwoFilesPatch(diff.path, diff.path, before, after, '', '', {
      context: CONTEXT_LINES
    })
      .split('\n')
      .slice(4)

    const truncated = body.length > MAX_PATCH_LINES
    const shown = truncated
      ? [...body.slice(0, MAX_PATCH_LINES), `… ${body.length - MAX_PATCH_LINES} more lines`]
      : body

    patches.push({
      path: diff.path,
      patch: shown.join('\n').trimEnd(),
      added: body.filter((line) => line.startsWith('+')).length,
      removed: body.filter((line) => line.startsWith('-')).length,
      truncated
    })
  }

  return patches
}
