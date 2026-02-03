/**
 * Version control types for CLIRabbit.
 *
 * These types wrap isomorphic-git operations for managing
 * source code versions, branches, and history.
 */

/**
 * A git commit.
 */
export interface Commit {
  /** Git commit SHA. */
  oid: string
  /** Commit message. */
  message: string
  /** Author name. */
  author: string
  /** ISO timestamp. */
  timestamp: string
  /** Parent commit SHA(s). */
  parents: string[]
}

/**
 * A git branch.
 */
export interface Branch {
  /** Branch name. */
  name: string
  /** Current head commit SHA. */
  head: string
  /** Whether this is the current branch. */
  isCurrent: boolean
}

/**
 * Version control state.
 */
export interface VersionState {
  /** Current branch name. */
  currentBranch: string
  /** Current HEAD commit SHA. */
  head: string
  /** Whether there are uncommitted changes. */
  hasChanges: boolean
  /** List of modified files. */
  modifiedFiles: string[]
}

/**
 * File diff between commits.
 */
export interface FileDiff {
  /** File path. */
  path: string
  /** Type of change. */
  type: 'add' | 'modify' | 'delete'
  /** Old content. */
  oldContent?: string
  /** New content. */
  newContent?: string
}

/**
 * Merge conflict information.
 */
export interface MergeConflict {
  /** File path with conflict. */
  path: string
  /** Our version. */
  ours: string
  /** Their version. */
  theirs: string
}

/**
 * Merge result.
 */
export interface MergeResult {
  /** Whether merge succeeded. */
  success: boolean
  /** Conflicts if any. */
  conflicts?: MergeConflict[]
}
