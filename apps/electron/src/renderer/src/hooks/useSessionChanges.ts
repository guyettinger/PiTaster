import { useEffect, useRef, useState } from 'react'
import { buildPatchFromDiff } from '../lib/commitPatches'
import type { FilePatch } from '@anyapp/core'

/**
 * What {@link useSessionChanges} gives its caller.
 */
export interface SessionChanges {
  /** One patch per file committed since the session's baseline. */
  patches: FilePatch[]
  /**
   * Every file committed since the baseline, whether or not it has a patch.
   *
   * A binary or oversized file changes without producing text to diff, and losing
   * the row would be worse than losing the preview — the strip's job is to say what
   * was touched.
   */
  committedPaths: string[]
  /** Working-tree paths git reports as modified but not yet committed. */
  uncommitted: string[]
  /** True while the first read for the current session is in flight. */
  isLoading: boolean
}

/** Nothing changed. A frozen constant so an idle strip never re-renders on identity. */
const NOTHING: SessionChanges = {
  patches: [],
  committedPaths: [],
  uncommitted: [],
  isLoading: false
}

/**
 * Files anyapp writes into a sub-app that are not the sub-app's code.
 *
 * `.anyapp-meta.json` is tracked — `initGitRepo` adds every file — and rewritten
 * whenever anything about the app changes, including its `updatedAt`. So it sits
 * permanently modified, and without this the strip opens every session announcing
 * one changed file before the agent has done anything. A strip that is never empty
 * is a strip nobody reads. `.chat-sessions.json` is the same kind of bookkeeping.
 *
 * This hides them from the *strip*, not from git: the History panel still reports
 * them, which is the right place for a file that genuinely is committed.
 */
const HOUSEKEEPING_FILES = new Set(['.anyapp-meta.json', '.chat-sessions.json'])

/**
 * Whether a path is the sub-app's own content rather than anyapp's bookkeeping.
 * @param path - A path relative to the app root
 * @returns True when the file belongs in the strip
 */
function isAppContent(path: string): boolean {
  return !HOUSEKEEPING_FILES.has(path)
}

/**
 * Options for {@link useSessionChanges}.
 */
export interface UseSessionChangesOptions {
  /** The app the session belongs to. */
  appId: string
  /** The app root, for the version IPC calls. */
  appPath: string
  /** The session to measure, or null when there is none. */
  sessionId: string | null
  /** Bump to force a refetch — a finished turn, a rollback, a branch switch. */
  revision: number
}

/**
 * What a chat session has changed, as git sees it.
 *
 * The measurement is a diff from the commit HEAD was at when the session became
 * active to the commit it is at now, plus whatever git reports as uncommitted.
 * Reading it from git rather than from the transcript's tool calls is what makes
 * a file written five times one row with one net diff, and what lets the user's
 * own manual edits show up at all.
 *
 * Nothing here is new machinery. `version:diff` answers with whole before and
 * after contents, `buildPatchFromDiff` turns those into the patches `DiffView`
 * renders — the same pair the History panel already uses to expand a commit.
 *
 * Every failure reads as "nothing changed". An app with no repo, a baseline that
 * no longer resolves after a branch switch, a version manager that throws: none
 * of them is worth an error state in a composer, and the next turn tries again.
 *
 * @param options - The session to measure and when to re-measure it
 * @returns The session's changed files
 */
export function useSessionChanges(options: UseSessionChangesOptions): SessionChanges {
  const { appId, appPath, sessionId, revision } = options
  const [changes, setChanges] = useState<SessionChanges>(NOTHING)

  // Guards a stale response. A slow read for a session the user has already left
  // must not overwrite the new session's answer — the same hazard, and the same
  // fix, as the history payload guard in `Chat.tsx`.
  const requestRef = useRef(0)

  // The session the current answer describes. A refetch on a bumped revision keeps
  // what is on screen while it runs, because it is about to say almost the same
  // thing; a refetch after a session *switch* must not, or the composer goes on
  // naming the previous conversation's files until the read lands.
  const shownFor = useRef<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      shownFor.current = null
      setChanges(NOTHING)
      return
    }

    const request = ++requestRef.current
    let cancelled = false
    const sameSession = shownFor.current === sessionId
    shownFor.current = sessionId
    setChanges((previous) =>
      sameSession ? { ...previous, isLoading: true } : { ...NOTHING, isLoading: true }
    )

    void (async () => {
      let next = NOTHING
      try {
        const [baseline, state] = await Promise.all([
          window.electronAPI.getSessionBaseline(appId, sessionId),
          window.electronAPI.getVersionState(appPath)
        ])

        // No baseline, or nothing committed since it: the committed half is empty,
        // but uncommitted work is still worth showing and is known independently.
        const diffs =
          baseline && state.head && baseline !== state.head
            ? await window.electronAPI.getDiff(baseline, state.head, appPath)
            : []
        const changed = diffs.filter((diff) => isAppContent(diff.path))

        next = {
          // `buildPatchFromDiff` drops a file whose two sides are identical, which
          // is how a binary or oversized blob arrives — hence the separate path list.
          patches: buildPatchFromDiff(changed),
          committedPaths: changed.map((diff) => diff.path),
          uncommitted: state.hasChanges ? state.modifiedFiles.filter(isAppContent) : [],
          isLoading: false
        }
      } catch {
        next = NOTHING
      }

      if (!cancelled && request === requestRef.current) setChanges(next)
    })()

    return () => {
      cancelled = true
    }
  }, [appId, appPath, sessionId, revision])

  return changes
}
