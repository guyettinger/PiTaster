import { useState, useEffect, useCallback } from 'react'
import { RefreshIcon, PlusIcon } from './icons'
import { formatRelativeTime } from '../lib/relativeTime'
import type { Branch, Commit, VersionState } from '../types/electron'
import type { FilePatch } from '@pitaster/core'
import { buildPatchFromDiff } from '../lib/commitPatches'
import { PatchList } from './DiffView'

/**
 * Git's empty tree object, for diffing the root commit.
 *
 * The first commit in a repository has no parent, so there is nothing to diff it
 * against. This hash is the well-known id of an empty tree and is present in every git
 * repository, which makes "everything this commit added" expressible as an ordinary
 * diff rather than a special case in the UI.
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Props for the VersionControl component.
 */
interface VersionControlProps {
  /** Path to the app directory for git operations. */
  appPath: string
  /** Callback when rollback is triggered. */
  onRollback: (commitId: string) => void
  /** Callback when branch is switched. */
  onBranchSwitch: (branchName: string) => void
  /** Callback when new branch is created. */
  onBranchCreate: (name: string) => void
}

/**
 * The focused app's branches and commit history, docked beside the workspace.
 *
 * The shell owns this panel's frame — width, background, and border — so the
 * component contributes only its content.
 */
export function VersionControl({
  appPath,
  onRollback,
  onBranchSwitch,
  onBranchCreate
}: VersionControlProps) {
  const [state, setState] = useState<VersionState | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [history, setHistory] = useState<Commit[]>([])
  /**
   * The commit whose contents are open, and what it changed.
   *
   * This panel could roll the app back to a commit but never show what that commit
   * contained — `getDiff` has been plumbed through preload since it was written with no
   * caller. Restoring a change you cannot see is the thing the diff fixes.
   */
  const [openCommit, setOpenCommit] = useState<string | null>(null)
  const [commitPatches, setCommitPatches] = useState<FilePatch[] | null>(null)
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadVersionData = useCallback(async () => {
    if (!appPath) return
    
    try {
      setIsLoading(true)
      setError(null)
      const [versionState, branchList, commitHistory] = await Promise.all([
        window.electronAPI.getVersionState(appPath),
        window.electronAPI.getBranches(appPath),
        window.electronAPI.getHistory(20, appPath)
      ])
      setState(versionState)
      setBranches(branchList)
      setHistory(commitHistory)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load version data'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [appPath])

  useEffect(() => {
    loadVersionData()
  }, [loadVersionData])

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      try {
        await window.electronAPI.switchBranch(branchName, appPath)
        onBranchSwitch(branchName)
        await loadVersionData()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch branch'
        setError(errorMessage)
      }
    },
    [appPath, onBranchSwitch, loadVersionData]
  )

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return

    try {
      await window.electronAPI.createBranch(newBranchName, appPath)
      onBranchCreate(newBranchName)
      setNewBranchName('')
      setIsCreatingBranch(false)
      await loadVersionData()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create branch'
      setError(errorMessage)
    }
  }, [newBranchName, appPath, onBranchCreate, loadVersionData])

  /**
   * Open or close a commit's diff.
   *
   * A commit is diffed against its own first parent, which is what "what this commit
   * changed" means. The root commit has no parent, so it is compared against git's empty
   * tree — the diff is then the whole initial import, which is correct.
   *
   * @param commit - The commit to show
   */
  const toggleCommit = useCallback(
    async (commit: Commit) => {
      if (openCommit === commit.oid) {
        setOpenCommit(null)
        setCommitPatches(null)
        return
      }

      setOpenCommit(commit.oid)
      setCommitPatches(null)
      try {
        const parent = commit.parents[0] ?? EMPTY_TREE
        const diffs = await window.electronAPI.getDiff(parent, commit.oid, appPath)
        setCommitPatches(buildPatchFromDiff(diffs))
      } catch {
        setCommitPatches([])
      }
    },
    [openCommit, appPath]
  )

  const handleRollback = useCallback(
    async (commitOid: string) => {
      try {
        await window.electronAPI.rollback(commitOid, appPath)
        onRollback(commitOid)
        await loadVersionData()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to rollback'
        setError(errorMessage)
      }
    },
    [appPath, onRollback, loadVersionData]
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="eyebrow text-ash">History</h2>
        <button
          onClick={loadVersionData}
          className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
          title="Reload history"
        >
          <RefreshIcon size={15} />
        </button>
      </header>

      {isLoading ? (
        <p className="flex flex-1 items-center justify-center text-[13px] text-ash">Loading…</p>
      ) : error ? (
        <div className="p-3">
          <p className="text-[13px] text-bone">{error}</p>
          <button
            onClick={loadVersionData}
            className="mt-2 text-[13px] text-keylime hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !state?.head ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="text-[13px] text-bone">Nothing committed yet</p>
          <p className="mt-1.5 text-[12px] text-ash">
            The first change the agent writes starts this app&rsquo;s history.
          </p>
        </div>
      ) : (
        <>
          {/* Branch */}
          <div className="border-b border-line p-3">
            <label className="eyebrow block text-ash" htmlFor="vc-branch">
              Branch
            </label>
            <select
              id="vc-branch"
              value={state?.currentBranch ?? 'main'}
              onChange={(e) => handleBranchSwitch(e.target.value)}
              className="mt-1.5 w-full rounded border border-line bg-raised px-2 py-1.5 font-mono text-[12.5px] text-bone transition-colors hover:border-ash"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>

            {isCreatingBranch ? (
              <div className="mt-2 flex gap-1">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="branch-name"
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[12.5px] text-bone placeholder-ash"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateBranch()
                    if (e.key === 'Escape') {
                      setIsCreatingBranch(false)
                      setNewBranchName('')
                    }
                  }}
                />
                <button
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                  className="shrink-0 rounded bg-keylime px-2 py-1 text-[12px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreatingBranch(true)}
                className="mt-2 flex items-center gap-1 text-[12.5px] text-ash transition-colors hover:text-bone"
              >
                <PlusIcon size={13} />
                New branch
              </button>
            )}
          </div>

          {/* Uncommitted work */}
          {state?.hasChanges && (
            <div className="border-b border-line bg-keylime/10 px-3 py-3">
              <p className="text-[12.5px] text-bone">
                {state.modifiedFiles.length} uncommitted change
                {state.modifiedFiles.length === 1 ? '' : 's'}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ash">
                {state.modifiedFiles.slice(0, 3).join(', ')}
                {state.modifiedFiles.length > 3 && ` +${state.modifiedFiles.length - 3} more`}
              </p>
            </div>
          )}

          {/* Commits */}
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {history.length === 0 ? (
              <p className="px-3 text-[13px] text-ash">No commits yet</p>
            ) : (
              <ol className="relative">
                {/* The spine every commit hangs off. */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-3 left-4 top-3 w-px bg-line"
                />
                {history.map((commit, i) => (
                  <li
                    key={commit.oid}
                    className="group relative flex items-start gap-2 px-3 py-2 transition-colors hover:bg-raised/60"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-panel ${
                        i === 0 ? 'bg-patina' : 'bg-line'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => toggleCommit(commit)}
                        className="block w-full text-left"
                        title={`Show what ${commit.oid.slice(0, 7)} changed`}
                      >
                        <p className="truncate text-[12.5px] text-bone" title={commit.message}>
                          {commit.message}
                        </p>
                        <p className="font-mono text-[11px] text-ash">
                          {commit.oid.slice(0, 7)} · {formatRelativeTime(commit.timestamp)}
                        </p>
                      </button>
                      {openCommit === commit.oid && (
                        <div className="mt-2">
                          {commitPatches === null ? (
                            <p className="text-[11px] text-ash">Loading the diff…</p>
                          ) : commitPatches.length === 0 ? (
                            <p className="text-[11px] text-ash">This commit changed nothing.</p>
                          ) : (
                            <PatchList patches={commitPatches} />
                          )}
                        </div>
                      )}
                    </div>
                    {i > 0 && (
                      <button
                        onClick={() => handleRollback(commit.oid)}
                        className="hidden shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-ash transition-colors hover:bg-line hover:text-patina group-hover:block group-focus-within:block"
                        title={`Roll the app back to ${commit.oid.slice(0, 7)}`}
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {state && (
            <div className="border-t border-line px-3 py-2">
              <p className="eyebrow text-ash">
                Head <span className="ml-1 font-mono normal-case tracking-normal text-bone">{state.head.slice(0, 7)}</span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
