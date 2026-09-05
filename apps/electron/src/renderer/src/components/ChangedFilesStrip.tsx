import { useCallback, useMemo, useState } from 'react'
import { DiffView } from './DiffView'
import { GaugeCard, GaugePopover } from './GaugePopover'
import { ChevronDownIcon } from './icons'
import type { FilePatch } from '@pitaster/core'

/** Width of a row's diffstat bar at full scale, in pixels. */
const STAT_BAR_WIDTH = 64

/**
 * One file this session changed.
 */
export interface ChangedFile {
  /** Path relative to the app root. */
  path: string
  /** The file's net diff, or null when there is none to show yet. */
  patch: FilePatch | null
  /** Where the change stands. */
  state: 'committed' | 'uncommitted' | 'pending'
}

/**
 * Options for {@link collectChangedFiles}.
 */
export interface CollectChangedFilesOptions {
  /** Net diffs since the session's baseline commit. */
  patches: FilePatch[]
  /** Every file committed since the baseline, including those with no patch. */
  committedPaths: string[]
  /** Working-tree paths git reports as modified. */
  uncommitted: string[]
  /** Paths the agent wrote this turn, before the next git read absorbs them. */
  pendingPaths: readonly string[]
}

/**
 * Merge the three things that know a file changed into one ordered list.
 *
 * They overlap, and the precedence matters. A path the agent just wrote is
 * `pending` only until git can account for it — once a patch exists the patch is
 * the better answer, because it is the *net* change across every write in the
 * session rather than the last one. A path git reports as modified but that also
 * has a committed patch is shown once, as committed with its diff; saying it twice
 * would double the file count the strip leads with.
 *
 * Order is churn-descending within each group, with the files the agent just
 * touched first. git reports paths in tree order, which carries no information
 * about what this conversation did; churn does, and recency does.
 *
 * @param options - The three sources
 * @returns The changed files, most interesting first
 */
export function collectChangedFiles(options: CollectChangedFilesOptions): ChangedFile[] {
  const { patches, committedPaths, uncommitted, pendingPaths } = options

  const churnOf = (file: ChangedFile): number =>
    file.patch ? file.patch.added + file.patch.removed : 0

  const pending = new Set(pendingPaths)
  const seen = new Set<string>()
  const committed: ChangedFile[] = []

  // Driven by the path list, not the patch list. A binary or oversized file is
  // committed and has no patch, and it still belongs on the list — churn of zero
  // sorts it below everything that can show a number.
  const byPath = new Map(patches.map((patch) => [patch.path, patch]))
  for (const path of [...committedPaths, ...byPath.keys()]) {
    if (seen.has(path)) continue
    seen.add(path)
    committed.push({ path, patch: byPath.get(path) ?? null, state: 'committed' })
  }

  const working: ChangedFile[] = []
  for (const path of uncommitted) {
    if (seen.has(path)) continue
    seen.add(path)
    working.push({ path, patch: null, state: 'uncommitted' })
  }
  for (const path of pendingPaths) {
    if (seen.has(path)) continue
    seen.add(path)
    working.push({ path, patch: null, state: 'pending' })
  }

  const byInterest = (a: ChangedFile, b: ChangedFile): number => {
    const recency = Number(pending.has(b.path)) - Number(pending.has(a.path))
    return recency !== 0 ? recency : churnOf(b) - churnOf(a)
  }

  return [...committed.sort(byInterest), ...working.sort(byInterest)]
}

/**
 * Props for {@link ChangedFilesStrip}.
 */
export interface ChangedFilesStripProps {
  /** Net diffs since the session's baseline commit. */
  patches: FilePatch[]
  /** Every file committed since the baseline, including those with no patch. */
  committedPaths: string[]
  /** Working-tree paths git reports as modified. */
  uncommitted: string[]
  /** Paths the agent wrote this turn. */
  pendingPaths: readonly string[]
  /** The file being written right now, or null when nothing is. */
  writingPath: string | null
  /** Open a file in its own Code panel. */
  onOpenFile: (path: string) => void
  /** Open the Changes panel. */
  onOpenPanel: () => void
}

/**
 * What this conversation has changed, as one gauge in the instrument row.
 *
 * The transcript already shows each individual write, and the History panel shows each
 * commit. Neither answers the question a person actually has after twenty turns —
 * *what has this touched?* — without scrolling or expanding one thing at a time.
 *
 * It used to hide itself when nothing had changed, which was right when it owned a row
 * of its own and wrong now: a gauge that vanishes moves every gauge beside it, and the
 * row exists to stop the composer moving. An idle session reads `no changes` instead,
 * dimmed, and its card is suppressed rather than opened onto an empty list.
 */
export function ChangedFilesStrip(props: ChangedFilesStripProps) {
  const {
    patches,
    committedPaths,
    uncommitted,
    pendingPaths,
    writingPath,
    onOpenFile,
    onOpenPanel
  } = props
  const [expanded, setExpanded] = useState<string | null>(null)

  const files = useMemo(
    () => collectChangedFiles({ patches, committedPaths, uncommitted, pendingPaths }),
    [patches, committedPaths, uncommitted, pendingPaths]
  )

  const added = patches.reduce((total, patch) => total + patch.added, 0)
  const removed = patches.reduce((total, patch) => total + patch.removed, 0)

  const open = useCallback((path: string) => onOpenFile(path), [onOpenFile])

  const label = writingPath
    ? `Writing ${writingPath}`
    : files.length === 0
      ? 'no changes'
      : `${files.length} file${files.length === 1 ? '' : 's'}`

  return (
    <GaugePopover
      label={`Changes: ${label}`}
      hasCard={files.length > 0}
      trigger={
        writingPath ? (
          <>
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-keylime"
            />
            <span className="min-w-0 truncate font-mono text-[11px] text-keylime">
              {writingPath}
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                files.length === 0 ? 'bg-line' : 'bg-patina'
              }`}
            />
            <span className={files.length === 0 ? 'opacity-60' : ''}>{label}</span>
            {added + removed > 0 && <Stat added={added} removed={removed} />}
          </>
        )
      }
    >
{(close) => (
        <GaugeCard width="w-[26rem]">
          <div className="max-h-[24rem] overflow-y-auto">
            <ChangedFileList
              files={files}
              expanded={expanded}
              onToggle={setExpanded}
              onOpen={open}
            />
          </div>

          <div className="mt-2 border-t border-line px-3 pt-2">
            <button
              onClick={() => {
                close()
                onOpenPanel()
              }}
              className="rounded px-2 py-1 text-ash transition-colors hover:bg-raised hover:text-bone"
            >
              Open Changes →
            </button>
          </div>
        </GaugeCard>
      )}
    </GaugePopover>
  )
}

/**
 * Props for {@link ChangedFileList}.
 */
export interface ChangedFileListProps {
  /** The session's changed files, already ordered. */
  files: ChangedFile[]
  /** The path whose diff is open, if any. */
  expanded: string | null
  /** Open or close a file's diff. */
  onToggle: (path: string | null) => void
  /** Open a file in its own Code panel. */
  onOpen: (path: string) => void
}

/**
 * The two groups of changed files, with their diffs on request.
 *
 * Exported because the gauge's card and the Changes panel must show the same rows.
 * They differ only in how much height they have to show them in, which is a property
 * of where they are rendered rather than of what they render.
 */
export function ChangedFileList({ files, expanded, onToggle, onOpen }: ChangedFileListProps) {
  return (
    <>
      <FileGroup
        label="Committed this session"
        files={files.filter((file) => file.state === 'committed')}
        expanded={expanded}
        onToggle={onToggle}
        onOpen={onOpen}
      />
      <FileGroup
        label="Not yet committed"
        files={files.filter((file) => file.state !== 'committed')}
        expanded={expanded}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    </>
  )
}

/**
 * Props for {@link FileGroup}.
 */
interface FileGroupProps {
  /** What the group is. */
  label: string
  /** Its files, already ordered. */
  files: ChangedFile[]
  /** The path whose diff is open, if any. */
  expanded: string | null
  /** Open or close a file's diff. */
  onToggle: (path: string | null) => void
  /** Open a file in its own Code panel. */
  onOpen: (path: string) => void
}

/**
 * One labelled run of rows in the list. Renders nothing when it is empty, so a
 * session with no uncommitted work shows one group rather than an empty heading.
 */
function FileGroup({ label, files, expanded, onToggle, onOpen }: FileGroupProps) {
  if (files.length === 0) return null

  // The bar is comparative, so it is scaled against the busiest file in the group
  // rather than an absolute number of lines — a session of small edits should still
  // show which of them was the big one.
  const busiest = files.reduce(
    (most, file) => Math.max(most, file.patch ? file.patch.added + file.patch.removed : 0),
    0
  )

  return (
    <section className="border-b border-line last:border-b-0">
      <h3 className="eyebrow px-3 pb-1 pt-2.5 text-ash">{label}</h3>
      <ul className="pb-1.5">
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            busiest={busiest}
            isExpanded={expanded === file.path}
            onToggle={() => onToggle(expanded === file.path ? null : file.path)}
            onOpen={() => onOpen(file.path)}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * Props for {@link FileRow}.
 */
interface FileRowProps {
  /** The file this row is about. */
  file: ChangedFile
  /** Churn of the busiest file in the group, for scaling the bar. */
  busiest: number
  /** Whether this row's diff is showing. */
  isExpanded: boolean
  /** Show or hide this row's diff. */
  onToggle: () => void
  /** Open the file in its own Code panel. */
  onOpen: () => void
}

/**
 * One file: its path, its diffstat, and its diff on request.
 *
 * Two targets, deliberately. The path is navigation — it opens the file the way
 * the file tree does. The stat is inspection — it opens the diff in place, which
 * is the cheaper of the two questions and the one more often asked.
 */
function FileRow({ file, busiest, isExpanded, onToggle, onOpen }: FileRowProps) {
  const directory = file.path.includes('/') ? `${file.path.slice(0, file.path.lastIndexOf('/'))}/` : ''

  return (
    <li>
      <div className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-raised/60">
        <button
          onClick={onOpen}
          title={`Open ${file.path}`}
          className="flex min-w-0 flex-1 items-baseline gap-0 text-left font-mono text-[11px]"
        >
          <span className="truncate text-ash">{directory}</span>
          <span className="truncate text-bone">{basename(file.path)}</span>
        </button>

        {file.patch ? (
          <button
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Hide' : 'Show'} the diff for ${file.path}`}
            className="flex shrink-0 items-center gap-2 rounded py-0.5 pl-2 text-ash transition-colors hover:text-bone"
          >
            <StatBar patch={file.patch} busiest={busiest} />
            <Stat added={file.patch.added} removed={file.patch.removed} />
            <ChevronDownIcon
              size={12}
              className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        ) : (
          <span className="shrink-0 pl-2 text-[10.5px] text-ash">{describeNoPatch(file.state)}</span>
        )}
      </div>

      {isExpanded && file.patch && (
        <div className="px-3 pb-2">
          <DiffView patch={file.patch} />
        </div>
      )}
    </li>
  )
}

/**
 * Props for {@link Stat}.
 */
interface StatProps {
  /** Lines added. */
  added: number
  /** Lines removed. */
  removed: number
}

/**
 * A file's line counts, in the app's two change colors.
 *
 * A zero side is omitted rather than printed: a pure addition reads as `+40`, not
 * `+40 −0`, which is how git says it and one fewer number to skip past.
 */
function Stat({ added, removed }: StatProps) {
  return (
    <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
      {added > 0 && <span className="text-patina">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="text-rust">−{removed}</span>}
    </span>
  )
}

/**
 * Props for {@link StatBar}.
 */
interface StatBarProps {
  /** The file's diff. */
  patch: FilePatch
  /** Churn of the busiest file in the group. */
  busiest: number
}

/**
 * A file's churn as a two-tone bar, the way `git diff --stat` draws it.
 *
 * Length is the size of the change relative to the busiest file in the group;
 * the split is additions against removals. It is the one thing in the list you
 * can read without reading — which file took the brunt, and whether the agent
 * was adding or rewriting.
 */
function StatBar({ patch, busiest }: StatBarProps) {
  const churn = patch.added + patch.removed
  if (churn === 0 || busiest === 0) return null

  // A one-line change against a four-hundred-line one would round to nothing, so
  // the scale has a floor: every file that changed at all draws something.
  const scale = Math.max(0.08, churn / busiest)

  return (
    <span
      aria-hidden
      className="hidden h-1 shrink-0 overflow-hidden rounded-[1px] bg-line sm:block"
      style={{ width: STAT_BAR_WIDTH }}
    >
      <span className="flex h-full" style={{ width: `${scale * 100}%` }}>
        <span className="bg-patina" style={{ width: `${(patch.added / churn) * 100}%` }} />
        <span className="flex-1 bg-rust" />
      </span>
    </span>
  )
}

/**
 * Why a row has no diff to show.
 *
 * Each answer names a different situation, because they are fixed differently: one
 * resolves itself when the turn ends, one when the work is committed, and one never
 * will. A single "no diff" would make the last look like the first.
 * @param state - Where the file's change stands
 * @returns A short phrase for the row
 */
function describeNoPatch(state: ChangedFile['state']): string {
  if (state === 'pending') return 'just written'
  if (state === 'uncommitted') return 'not committed'
  return 'no preview'
}

/**
 * The last segment of a path.
 * @param path - A path relative to the app root
 * @returns Its file name
 */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
