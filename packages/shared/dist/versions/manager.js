/**
 * VersionManager - Wraps isomorphic-git for version control operations.
 *
 * Provides commit, branch, rollback, merge, and diff capabilities
 * for managing source code versions.
 */
import * as git from 'isomorphic-git';
import fs from 'node:fs';
/** Default author for commits. */
const AUTHOR = { name: 'anyapp Agent', email: 'agent@anyapp.local' };
/**
 * Manages version control operations using isomorphic-git.
 */
export class VersionManager {
    dir;
    /**
     * Creates a new VersionManager.
     * @param dir - The git repository directory.
     */
    constructor(dir) {
        this.dir = dir;
    }
    /**
     * Commit staged files with a message.
     * @param options - Commit options including message and files.
     * @returns The created commit.
     */
    async commit(options) {
        // Stage files
        for (const filepath of options.files) {
            await git.add({ fs, dir: this.dir, filepath });
        }
        // Commit
        const oid = await git.commit({
            fs,
            dir: this.dir,
            message: options.message,
            author: AUTHOR
        });
        return this.getCommit(oid);
    }
    /**
     * Get a specific commit by OID.
     * @param oid - The commit SHA.
     * @returns The commit details.
     */
    async getCommit(oid) {
        const { commit } = await git.readCommit({ fs, dir: this.dir, oid });
        return {
            oid,
            message: commit.message.trim(),
            author: commit.author.name,
            timestamp: new Date(commit.author.timestamp * 1000).toISOString(),
            parents: commit.parent
        };
    }
    /**
     * Rollback to a specific commit.
     * @param commitOid - The commit SHA to rollback to.
     */
    async rollback(commitOid) {
        await git.checkout({
            fs,
            dir: this.dir,
            ref: commitOid,
            force: true
        });
    }
    /**
     * Create a new branch and optionally switch to it.
     * @param options - Branch creation options.
     * @returns The created branch.
     */
    async createBranch(options) {
        await git.branch({
            fs,
            dir: this.dir,
            ref: options.name,
            checkout: options.checkout ?? true,
            object: options.fromCommit
        });
        return this.getBranch(options.name);
    }
    /**
     * Get a specific branch.
     * @param name - The branch name.
     * @returns The branch details.
     */
    async getBranch(name) {
        const current = await git.currentBranch({ fs, dir: this.dir });
        const head = await git.resolveRef({ fs, dir: this.dir, ref: name });
        return {
            name,
            head,
            isCurrent: name === current
        };
    }
    /**
     * Switch to a different branch.
     * @param branchName - The branch to switch to.
     */
    async switchBranch(branchName) {
        await git.checkout({
            fs,
            dir: this.dir,
            ref: branchName
        });
    }
    /**
     * List all branches.
     * @returns Array of all branches.
     */
    async listBranches() {
        const branches = await git.listBranches({ fs, dir: this.dir });
        const current = await git.currentBranch({ fs, dir: this.dir });
        return Promise.all(branches.map(async (name) => ({
            name,
            head: await git.resolveRef({ fs, dir: this.dir, ref: name }),
            isCurrent: name === current
        })));
    }
    /**
     * Delete a branch.
     * @param branchName - The branch to delete.
     * @throws Error if trying to delete current branch.
     */
    async deleteBranch(branchName) {
        const current = await git.currentBranch({ fs, dir: this.dir });
        if (branchName === current) {
            throw new Error('Cannot delete current branch');
        }
        await git.deleteBranch({ fs, dir: this.dir, ref: branchName });
    }
    /**
     * Get commit history.
     * @param options - History options including depth.
     * @returns Array of commits.
     */
    async getHistory(options) {
        const commits = await git.log({
            fs,
            dir: this.dir,
            depth: options?.depth ?? 50
        });
        return commits.map((c) => ({
            oid: c.oid,
            message: c.commit.message.trim(),
            author: c.commit.author.name,
            timestamp: new Date(c.commit.author.timestamp * 1000).toISOString(),
            parents: c.commit.parent
        }));
    }
    /**
     * Merge another branch into current.
     * @param branchName - The branch to merge.
     * @returns The merge result.
     */
    async merge(branchName) {
        try {
            await git.merge({
                fs,
                dir: this.dir,
                theirs: branchName,
                author: AUTHOR
            });
            return { success: true };
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'MergeConflictError') {
                return {
                    success: false,
                    conflicts: [] // Would need to parse conflicts from working directory
                };
            }
            throw error;
        }
    }
    /**
     * Get diff between two commits.
     * @param fromOid - The source commit SHA.
     * @param toOid - The target commit SHA.
     * @returns Array of file diffs.
     */
    async diff(fromOid, toOid) {
        const diffs = [];
        await git.walk({
            fs,
            dir: this.dir,
            trees: [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })],
            map: async (filepath, entries) => {
                if (filepath === '.')
                    return;
                const [A, B] = entries;
                const aOid = await A?.oid();
                const bOid = await B?.oid();
                if (aOid !== bOid) {
                    diffs.push({
                        path: filepath,
                        type: !aOid ? 'add' : !bOid ? 'delete' : 'modify'
                    });
                }
            }
        });
        return diffs;
    }
    /**
     * Get current version state.
     * @returns The current version state.
     */
    async getState() {
        const currentBranch = (await git.currentBranch({ fs, dir: this.dir })) ?? 'HEAD';
        const head = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' });
        const status = await git.statusMatrix({ fs, dir: this.dir });
        const modifiedFiles = status
            .filter((row) => {
            const [, headStatus, workdirStatus, stageStatus] = row;
            return headStatus !== workdirStatus || headStatus !== stageStatus;
        })
            .map((row) => row[0]);
        return {
            currentBranch,
            head,
            hasChanges: modifiedFiles.length > 0,
            modifiedFiles
        };
    }
}
