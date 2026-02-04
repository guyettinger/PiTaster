import { useState, useEffect, useCallback } from 'react'
import type { Branch, Commit, VersionState } from '../types/electron'

/**
 * Props for the VersionControl component.
 */
interface VersionControlProps {
  /** Callback when rollback is triggered. */
  onRollback: (commitId: string) => void
  /** Callback when branch is switched. */
  onBranchSwitch: (branchName: string) => void
  /** Callback when new branch is created. */
  onBranchCreate: (name: string) => void
  /** Whether version control panel is visible. */
  isVisible: boolean
}

/**
 * Format a timestamp to relative time.
 */
function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
}

/**
 * Version control panel component showing branches and commit history.
 */
export function VersionControl({
  onRollback,
  onBranchSwitch,
  onBranchCreate,
  isVisible
}: VersionControlProps) {
  const [state, setState] = useState<VersionState | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [history, setHistory] = useState<Commit[]>([])
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadVersionData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const [versionState, branchList, commitHistory] = await Promise.all([
        window.electronAPI.getVersionState(),
        window.electronAPI.getBranches(),
        window.electronAPI.getHistory(20)
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
  }, [])

  useEffect(() => {
    if (isVisible) {
      loadVersionData()
    }
  }, [isVisible, loadVersionData])

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      try {
        await window.electronAPI.switchBranch(branchName)
        onBranchSwitch(branchName)
        await loadVersionData()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch branch'
        setError(errorMessage)
      }
    },
    [onBranchSwitch, loadVersionData]
  )

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return

    try {
      await window.electronAPI.createBranch(newBranchName)
      onBranchCreate(newBranchName)
      setNewBranchName('')
      setIsCreatingBranch(false)
      await loadVersionData()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create branch'
      setError(errorMessage)
    }
  }, [newBranchName, onBranchCreate, loadVersionData])

  const handleRollback = useCallback(
    async (commitOid: string) => {
      try {
        await window.electronAPI.rollback(commitOid)
        onRollback(commitOid)
        await loadVersionData()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to rollback'
        setError(errorMessage)
      }
    },
    [onRollback, loadVersionData]
  )

  if (!isVisible) return null

  return (
    <div className="flex w-72 flex-col border-l border-neutral-800 bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Version Control</h2>
        <button
          onClick={loadVersionData}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          title="Refresh"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-neutral-500">Loading...</span>
        </div>
      ) : error ? (
        <div className="p-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={loadVersionData}
            className="mt-2 text-sm text-blue-400 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : !state?.head ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="text-sm text-neutral-400">No git repository found or no commits yet.</p>
          <p className="mt-2 text-xs text-neutral-500">
            Initialize a git repository with at least one commit to enable version control.
          </p>
        </div>
      ) : (
        <>
          {/* Branch Selector */}
          <div className="border-b border-neutral-800 p-3">
            <label className="text-xs font-medium text-neutral-500">Branch</label>
            <select
              value={state?.currentBranch ?? 'main'}
              onChange={(e) => handleBranchSwitch(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} {b.isCurrent && '(current)'}
                </option>
              ))}
            </select>

            {/* New Branch */}
            {isCreatingBranch ? (
              <div className="mt-2 flex gap-1">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="branch-name"
                  className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
                />
                <button
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                  className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreatingBranch(false)
                    setNewBranchName('')
                  }}
                  className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreatingBranch(true)}
                className="mt-2 text-sm text-blue-400 hover:underline"
              >
                + New Branch
              </button>
            )}
          </div>

          {/* Status */}
          {state?.hasChanges && (
            <div className="border-b border-neutral-800 bg-yellow-900/20 p-3">
              <span className="text-sm text-yellow-400">
                {state.modifiedFiles.length} uncommitted change(s)
              </span>
              <p className="mt-1 text-xs text-neutral-500">
                {state.modifiedFiles.slice(0, 3).join(', ')}
                {state.modifiedFiles.length > 3 && ` +${state.modifiedFiles.length - 3} more`}
              </p>
            </div>
          )}

          {/* History Timeline */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-3">
              <h3 className="mb-2 text-xs font-medium text-neutral-500">History</h3>
              <div className="space-y-1">
                {history.length === 0 ? (
                  <p className="text-sm text-neutral-500">No commits yet</p>
                ) : (
                  history.map((commit, i) => (
                    <div
                      key={commit.oid}
                      className="flex items-start gap-2 rounded p-2 hover:bg-neutral-800"
                    >
                      <div className="mt-1.5">
                        <div
                          className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-neutral-600'}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-neutral-200" title={commit.message}>
                          {commit.message}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {commit.oid.slice(0, 7)} · {formatTime(commit.timestamp)}
                        </p>
                      </div>
                      {i > 0 && (
                        <button
                          onClick={() => handleRollback(commit.oid)}
                          className="shrink-0 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-blue-400"
                          title="Rollback to this commit"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Current HEAD */}
          {state && (
            <div className="border-t border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                HEAD: <span className="font-mono text-neutral-400">{state.head.slice(0, 7)}</span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
