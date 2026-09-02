/**
 * A unified diff, rendered.
 *
 * This replaces `DiffViewer.tsx`, which printed two columns of whole files side by side
 * and computed no diff at all — and which nothing ever imported.
 *
 * The rows are built here rather than run through `lowlight`'s `diff` grammar. That
 * grammar colours the text of a `+` line and nothing else: no gutters, no line numbers,
 * no band behind the row. Line numbers are the part that matters most here, because they
 * are what `replace_lines` and `refactor`'s `apply_fix` take — a diff a person can read
 * a line number off is a diff they can act on.
 *
 * Additions are patina and removals are rust, the palette's existing green and red,
 * rather than a new pair introduced for this one component.
 */

import { useMemo } from 'react'
import type { FilePatch } from '@anyapp/core'

/** One rendered row of a diff. */
interface DiffRow {
  /** What the row represents. */
  kind: 'hunk' | 'add' | 'remove' | 'context' | 'note'
  /** Line number in the file before the change, where the row has one. */
  oldLine: number | null
  /** Line number in the file after the change, where the row has one. */
  newLine: number | null
  /** The row's text, without its diff marker. */
  text: string
}

/** Matches a hunk header and captures where each side resumes. */
const HUNK_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Turn a unified diff into rows with line numbers on both sides.
 *
 * @param patch - The unified diff body, without its file header
 * @returns The rows, in order
 */
export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of patch.split('\n')) {
    const hunk = HUNK_PATTERN.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: line })
      continue
    }

    // `buildPatch` appends a plain sentence when it cuts a long diff short. It carries
    // no marker, so it would otherwise be read as a removal.
    if (line.startsWith('… ')) {
      rows.push({ kind: 'note', oldLine: null, newLine: null, text: line })
      continue
    }

    if (line.startsWith('+')) {
      rows.push({ kind: 'add', oldLine: null, newLine: newLine++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'remove', oldLine: oldLine++, newLine: null, text: line.slice(1) })
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — true, and not worth a row.
      continue
    } else if (line.length > 0 || rows.length > 0) {
      rows.push({
        kind: 'context',
        oldLine: oldLine++,
        newLine: newLine++,
        text: line.startsWith(' ') ? line.slice(1) : line
      })
    }
  }

  return rows
}

/** Row background and text colour per kind. */
const ROW_STYLE: Record<DiffRow['kind'], string> = {
  add: 'bg-patina/10 text-bone',
  remove: 'bg-rust/10 text-bone',
  context: 'text-ash',
  hunk: 'bg-raised text-brass',
  note: 'text-ash italic'
}

/** The marker shown in the diff's own narrow column. */
const ROW_MARKER: Record<DiffRow['kind'], string> = {
  add: '+',
  remove: '-',
  context: ' ',
  hunk: '',
  note: ''
}

/**
 * Props for the DiffView component.
 */
interface DiffViewProps {
  /** The patch to render. */
  patch: FilePatch
}

/**
 * Renders one file's change as a unified diff.
 */
export function DiffView({ patch }: DiffViewProps) {
  const rows = useMemo(() => parsePatch(patch.patch), [patch.patch])

  return (
    <div className="overflow-hidden rounded border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-3 py-1.5">
        <span className="truncate font-mono text-xs text-bone">{patch.path}</span>
        <span className="shrink-0 font-mono text-xs">
          <span className="text-patina">+{patch.added}</span>{' '}
          <span className="text-rust">−{patch.removed}</span>
        </span>
      </div>

      {/* Wide diffs scroll inside this box; the page itself never scrolls sideways. */}
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs leading-relaxed">
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={ROW_STYLE[row.kind]}>
                <td className="w-10 select-none border-r border-line px-2 text-right align-top text-ash/60">
                  {row.oldLine ?? ''}
                </td>
                <td className="w-10 select-none border-r border-line px-2 text-right align-top text-ash/60">
                  {row.newLine ?? ''}
                </td>
                <td className="w-4 select-none px-1 text-center align-top">
                  {ROW_MARKER[row.kind]}
                </td>
                <td className="whitespace-pre px-1 align-top">{row.text || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Props for the PatchList component.
 */
interface PatchListProps {
  /** Every file the write changed. */
  patches: FilePatch[]
}

/**
 * Renders every file a single tool call changed.
 *
 * More than one is the `refactor` case: a rename touching eight files produces eight
 * patches from one call, and seeing them together is the point of having done it in one
 * call.
 */
export function PatchList({ patches }: PatchListProps) {
  if (patches.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {patches.map((patch) => (
        <DiffView key={patch.path} patch={patch} />
      ))}
    </div>
  )
}
