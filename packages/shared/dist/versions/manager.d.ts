/**
 * VersionManager - Wraps isomorphic-git for version control operations.
 *
 * Provides commit, branch, rollback, merge, and diff capabilities
 * for managing source code versions.
 */
import type { Commit, Branch, VersionState, FileDiff, MergeResult } from '@clirabbit/core';
/**
 * Options for creating a commit.
 */
export interface CommitOptions {
    /** Commit message. */
    message: string;
    /** Files to stage and commit (relative paths). */
    files: string[];
}
/**
 * Options for creating a branch.
 */
export interface CreateBranchOptions {
    /** Branch name. */
    name: string;
    /** Whether to checkout the branch after creation. */
    checkout?: boolean;
    /** Commit SHA to create branch from. */
    fromCommit?: string;
}
/**
 * Options for getting history.
 */
export interface HistoryOptions {
    /** Maximum number of commits to return. */
    depth?: number;
}
/**
 * Manages version control operations using isomorphic-git.
 */
export declare class VersionManager {
    private dir;
    /**
     * Creates a new VersionManager.
     * @param dir - The git repository directory.
     */
    constructor(dir: string);
    /**
     * Commit staged files with a message.
     * @param options - Commit options including message and files.
     * @returns The created commit.
     */
    commit(options: CommitOptions): Promise<Commit>;
    /**
     * Get a specific commit by OID.
     * @param oid - The commit SHA.
     * @returns The commit details.
     */
    getCommit(oid: string): Promise<Commit>;
    /**
     * Rollback to a specific commit.
     * @param commitOid - The commit SHA to rollback to.
     */
    rollback(commitOid: string): Promise<void>;
    /**
     * Create a new branch and optionally switch to it.
     * @param options - Branch creation options.
     * @returns The created branch.
     */
    createBranch(options: CreateBranchOptions): Promise<Branch>;
    /**
     * Get a specific branch.
     * @param name - The branch name.
     * @returns The branch details.
     */
    getBranch(name: string): Promise<Branch>;
    /**
     * Switch to a different branch.
     * @param branchName - The branch to switch to.
     */
    switchBranch(branchName: string): Promise<void>;
    /**
     * List all branches.
     * @returns Array of all branches.
     */
    listBranches(): Promise<Branch[]>;
    /**
     * Delete a branch.
     * @param branchName - The branch to delete.
     * @throws Error if trying to delete current branch.
     */
    deleteBranch(branchName: string): Promise<void>;
    /**
     * Get commit history.
     * @param options - History options including depth.
     * @returns Array of commits.
     */
    getHistory(options?: HistoryOptions): Promise<Commit[]>;
    /**
     * Merge another branch into current.
     * @param branchName - The branch to merge.
     * @returns The merge result.
     */
    merge(branchName: string): Promise<MergeResult>;
    /**
     * Get diff between two commits.
     * @param fromOid - The source commit SHA.
     * @param toOid - The target commit SHA.
     * @returns Array of file diffs.
     */
    diff(fromOid: string, toOid: string): Promise<FileDiff[]>;
    /**
     * Get current version state.
     * @returns The current version state.
     */
    getState(): Promise<VersionState>;
}
//# sourceMappingURL=manager.d.ts.map