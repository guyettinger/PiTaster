/**
 * VersionManager - Wraps isomorphic-git for version control operations.
 *
 * Provides commit, branch, rollback, merge, and diff capabilities
 * for managing source code versions.
 */

import * as git from 'isomorphic-git'
import fs from 'node:fs'
import type { Commit, Branch, VersionState, FileDiff, MergeResult } from '@anyapp/core'

/** Default author for commits. */
const AUTHOR = { name: 'anyapp Agent', email: 'agent@anyapp.local' }

/**
 * The largest blob whose contents a diff carries, in bytes.
 *
 * A diff's contents cross an IPC boundary whole, so this is what stands between a
 * committed build artifact and a renderer handed several megabytes of it. Past the
 * cap the file is still reported as changed — losing the row would be worse than
 * losing the preview — it simply has no text to show.
 */
const MAX_DIFF_BYTES = 512 * 1024

/**
 * The largest total a single diff carries, in bytes.
 *
 * The per-blob cap alone bounds nothing that matters: a commit range touching four
 * hundred files under the cap still builds one array of every one of their contents,
 * structure-clones it across IPC, and hands the whole thing to the renderer. This is
 * the ceiling on the *response*. Past it the remaining files are still reported —
 * they changed, and saying so is the point — they simply arrive without text, which
 * is exactly how a binary or oversized blob already arrives.
 */
const MAX_DIFF_TOTAL_BYTES = 4 * 1024 * 1024

/**
 * One side of a `git.walk` comparison.
 *
 * isomorphic-git types these loosely; this names only the three methods used here.
 */
interface WalkEntry {
  /** The entry's git object type. */
  type: () => Promise<string | void>
  /** The entry's object id. */
  oid: () => Promise<string | void>
  /** The entry's bytes, for a blob. `void` for a tree, which has none. */
  content: () => Promise<Uint8Array | void>
}

/**
 * Turn a blob's bytes into the text a diff can be computed from.
 *
 * Binary is detected by a NUL byte in the first kilobyte, which is what git itself
 * does, and answers undefined rather than mojibake: a "diff" of decoded PNG bytes
 * is noise that would push the real changes out of the view.
 * @param bytes - The blob's contents, or undefined when the side does not exist
 * @returns The decoded text, or undefined when there is none worth showing
 */
function decodeBlob(bytes: Uint8Array | void): string | undefined {
  if (!bytes) return undefined
  if (bytes.byteLength > MAX_DIFF_BYTES) return undefined
  if (bytes.subarray(0, 1024).includes(0)) return undefined
  return new TextDecoder().decode(bytes)
}

/**
 * Options for creating a commit.
 */
export interface CommitOptions {
  /** Commit message. */
  message: string
  /** Files to stage and commit (relative paths). */
  files: string[]
  /**
   * Paths to stage as removed (relative).
   *
   * Separate from {@link CommitOptions.files} because isomorphic-git needs a different
   * call: `git.add` reads the file from the working tree and throws `ENOENT` when it is
   * gone, so a deletion staged as an addition fails and the path stays in `HEAD` — where
   * the next rollback brings it back.
   */
  removed?: string[]
}

/**
 * Options for creating a branch.
 */
export interface CreateBranchOptions {
  /** Branch name. */
  name: string
  /** Whether to checkout the branch after creation. */
  checkout?: boolean
  /** Commit SHA to create branch from. */
  fromCommit?: string
}

/**
 * Options for getting history.
 */
export interface HistoryOptions {
  /** Maximum number of commits to return. */
  depth?: number
}

/**
 * Manages version control operations using isomorphic-git.
 */
export class VersionManager {
  /**
   * Creates a new VersionManager.
   * @param dir - The git repository directory.
   */
  constructor(private dir: string) {}

  /**
   * Check if the directory is a valid git repository with at least one commit.
   * @returns True if the repository is valid, false otherwise.
   */
  async isValidRepo(): Promise<boolean> {
    try {
      await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Commit staged files with a message.
   * @param options - Commit options including message, files, and removals.
   * @returns The created commit.
   */
  async commit(options: CommitOptions): Promise<Commit> {
    // Stage files
    for (const filepath of options.files) {
      await git.add({ fs, dir: this.dir, filepath })
    }

    for (const filepath of options.removed ?? []) {
      await git.remove({ fs, dir: this.dir, filepath })
    }

    // Commit
    const oid = await git.commit({
      fs,
      dir: this.dir,
      message: options.message,
      author: AUTHOR
    })

    return this.getCommit(oid)
  }

  /**
   * Get a specific commit by OID.
   * @param oid - The commit SHA.
   * @returns The commit details.
   */
  async getCommit(oid: string): Promise<Commit> {
    const { commit } = await git.readCommit({ fs, dir: this.dir, oid })
    return {
      oid,
      message: commit.message.trim(),
      author: commit.author.name,
      timestamp: new Date(commit.author.timestamp * 1000).toISOString(),
      parents: commit.parent
    }
  }

  /**
   * Rollback to a specific commit.
   * @param commitOid - The commit SHA to rollback to.
   */
  async rollback(commitOid: string): Promise<void> {
    await git.checkout({
      fs,
      dir: this.dir,
      ref: commitOid,
      force: true
    })
  }

  /**
   * Create a new branch and optionally switch to it.
   * @param options - Branch creation options.
   * @returns The created branch.
   */
  async createBranch(options: CreateBranchOptions): Promise<Branch> {
    await git.branch({
      fs,
      dir: this.dir,
      ref: options.name,
      checkout: options.checkout ?? true,
      object: options.fromCommit
    })

    return this.getBranch(options.name)
  }

  /**
   * Get a specific branch.
   * @param name - The branch name.
   * @returns The branch details.
   */
  async getBranch(name: string): Promise<Branch> {
    const current = await git.currentBranch({ fs, dir: this.dir })
    const head = await git.resolveRef({ fs, dir: this.dir, ref: name })

    return {
      name,
      head,
      isCurrent: name === current
    }
  }

  /**
   * Switch to a different branch.
   * @param branchName - The branch to switch to.
   */
  async switchBranch(branchName: string): Promise<void> {
    await git.checkout({
      fs,
      dir: this.dir,
      ref: branchName
    })
  }

  /**
   * List all branches.
   * @returns Array of all branches.
   */
  async listBranches(): Promise<Branch[]> {
    const branches = await git.listBranches({ fs, dir: this.dir })
    const current = await git.currentBranch({ fs, dir: this.dir })

    return Promise.all(
      branches.map(async (name: string) => ({
        name,
        head: await git.resolveRef({ fs, dir: this.dir, ref: name }),
        isCurrent: name === current
      }))
    )
  }

  /**
   * Delete a branch.
   * @param branchName - The branch to delete.
   * @throws Error if trying to delete current branch.
   */
  async deleteBranch(branchName: string): Promise<void> {
    const current = await git.currentBranch({ fs, dir: this.dir })
    if (branchName === current) {
      throw new Error('Cannot delete current branch')
    }
    await git.deleteBranch({ fs, dir: this.dir, ref: branchName })
  }

  /**
   * Get commit history.
   * @param options - History options including depth.
   * @returns Array of commits.
   */
  async getHistory(options?: HistoryOptions): Promise<Commit[]> {
    const commits = await git.log({
      fs,
      dir: this.dir,
      depth: options?.depth ?? 50
    })

    return commits.map((c: { oid: string; commit: { message: string; author: { name: string; timestamp: number }; parent: string[] } }) => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      timestamp: new Date(c.commit.author.timestamp * 1000).toISOString(),
      parents: c.commit.parent
    }))
  }

  /**
   * Merge another branch into current.
   * @param branchName - The branch to merge.
   * @returns The merge result.
   */
  async merge(branchName: string): Promise<MergeResult> {
    try {
      await git.merge({
        fs,
        dir: this.dir,
        theirs: branchName,
        author: AUTHOR
      })
      return { success: true }
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'MergeConflictError') {
        return {
          success: false,
          conflicts: [] // Would need to parse conflicts from working directory
        }
      }
      throw error
    }
  }

  /**
   * Get diff between two commits.
   *
   * The contents are the point. This reported a path and a type and nothing else
   * for as long as it existed, which meant every consumer that tried to *render* a
   * change got an empty answer: `buildPatchFromDiff` compares before against after
   * and drops a file whose two sides are identical, so a commit's diff in the
   * History panel was always blank. Reading the blobs is what makes the shape this
   * returns match the name.
   *
   * Directories are skipped. `git.walk` visits trees as well as blobs, and a
   * directory whose oid changed is not a change a person made — it is the sum of
   * the changes underneath it, already listed.
   *
   * The response has a total budget as well as a per-file one. Once it is spent the
   * remaining files are reported without their contents rather than dropped: a file
   * missing from this list reads as a file that did not change, which is the one
   * thing a diff must never say.
   * @param fromOid - The source commit SHA.
   * @param toOid - The target commit SHA.
   * @returns Array of file diffs, newest state in `newContent`.
   */
  async diff(fromOid: string, toOid: string): Promise<FileDiff[]> {
    const diffs: FileDiff[] = []
    let spent = 0

    await git.walk({
      fs,
      dir: this.dir,
      trees: [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })],
      map: async (filepath: string, entries: Array<WalkEntry | null>) => {
        if (filepath === '.') return

        const [A, B] = entries
        const [aType, bType] = await Promise.all([A?.type(), B?.type()])
        if (aType === 'tree' || bType === 'tree') return

        const [aOid, bOid] = await Promise.all([A?.oid(), B?.oid()])
        if (aOid === bOid) return

        const entry: FileDiff = {
          path: filepath,
          type: !aOid ? 'add' : !bOid ? 'delete' : 'modify'
        }

        if (spent < MAX_DIFF_TOTAL_BYTES) {
          const [aContent, bContent] = await Promise.all([A?.content(), B?.content()])
          entry.oldContent = decodeBlob(aContent)
          entry.newContent = decodeBlob(bContent)
          spent += (entry.oldContent?.length ?? 0) + (entry.newContent?.length ?? 0)
        }

        diffs.push(entry)
      }
    })

    return diffs
  }

  /**
   * Get current version state.
   * @returns The current version state.
   */
  async getState(): Promise<VersionState> {
    try {
      const currentBranch = (await git.currentBranch({ fs, dir: this.dir })) ?? 'HEAD'
      const head = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
      const status = await git.statusMatrix({ fs, dir: this.dir })

      const modifiedFiles = status
        .filter((row: [string, number, number, number]) => {
          const [, headStatus, workdirStatus, stageStatus] = row
          return headStatus !== workdirStatus || headStatus !== stageStatus
        })
        .map((row: [string, number, number, number]) => row[0])

      return {
        currentBranch,
        head,
        hasChanges: modifiedFiles.length > 0,
        modifiedFiles
      }
    } catch {
      // Repository doesn't exist or has no commits
      return {
        currentBranch: 'main',
        head: '',
        hasChanges: false,
        modifiedFiles: []
      }
    }
  }
}
