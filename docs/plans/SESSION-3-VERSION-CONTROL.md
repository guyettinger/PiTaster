# Session 3: Version Control (isomorphic-git)

## Overview

This session implements the version control system using `isomorphic-git` as the backend, providing branch, commit, rollback, and merge capabilities with a user-friendly UI abstraction.

**Estimated scope**: Medium  
**Prerequisites**: Session 2 complete (agent core working)  
**Deliverable**: Full version control with UI for branching, history, and rollback

## Objectives

1. Add isomorphic-git dependency
2. Implement VersionManager class wrapping git operations
3. Add version control types to packages/core
4. Create agent tools for version control
5. Integrate auto-commit into write_source tool
6. Build version control UI components

## Parallel Subagent Strategy

```
Main Agent (orchestrator)
├── Subagent A: Version control UI components
├── Main Agent: VersionManager implementation
└── Main Agent: Agent tool integration
```

---

## Part 1: Dependencies

### Update apps/electron/package.json

Add `isomorphic-git`:

```json
{
  "dependencies": {
    "isomorphic-git": "^1.27.0",
    // ... existing deps
  }
}
```

Run `bun install` after updating.

---

## Part 2: Type Definitions

### packages/core/src/versions.ts

```typescript
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
```

### Update packages/core/src/index.ts

```typescript
export * from './agent'
export * from './permissions'
export * from './messages'
export * from './versions'
```

---

## Part 3: VersionManager Implementation (Main Agent)

### packages/shared/src/versions/manager.ts

```typescript
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import type { Commit, Branch, VersionState, FileDiff, MergeResult } from '@anyapp/core'

const AUTHOR = { name: 'anyapp Agent', email: 'agent@anyapp.local' }

export class VersionManager {
  constructor(private dir: string) {}

  /**
   * Commit staged files with a message.
   */
  async commit(options: { message: string; files: string[] }): Promise<Commit> {
    // Stage files
    for (const filepath of options.files) {
      await git.add({ fs, dir: this.dir, filepath })
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
   */
  async createBranch(options: { name: string; checkout?: boolean; fromCommit?: string }): Promise<Branch> {
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
   */
  async listBranches(): Promise<Branch[]> {
    const branches = await git.listBranches({ fs, dir: this.dir })
    const current = await git.currentBranch({ fs, dir: this.dir })
    
    return Promise.all(branches.map(async name => ({
      name,
      head: await git.resolveRef({ fs, dir: this.dir, ref: name }),
      isCurrent: name === current
    })))
  }

  /**
   * Delete a branch.
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
   */
  async getHistory(options?: { depth?: number }): Promise<Commit[]> {
    const commits = await git.log({
      fs,
      dir: this.dir,
      depth: options?.depth ?? 50
    })
    
    return commits.map(c => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      timestamp: new Date(c.commit.author.timestamp * 1000).toISOString(),
      parents: c.commit.parent
    }))
  }

  /**
   * Merge another branch into current.
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
    } catch (error: any) {
      if (error.code === 'MergeConflictError') {
        return { 
          success: false, 
          conflicts: [] // Would need to parse conflicts
        }
      }
      throw error
    }
  }

  /**
   * Get diff between two commits.
   */
  async diff(fromOid: string, toOid: string): Promise<FileDiff[]> {
    const diffs: FileDiff[] = []
    
    await git.walk({
      fs,
      dir: this.dir,
      trees: [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })],
      map: async (filepath, [A, B]) => {
        if (filepath === '.') return
        
        const aOid = await A?.oid()
        const bOid = await B?.oid()
        
        if (aOid !== bOid) {
          diffs.push({
            path: filepath,
            type: !aOid ? 'add' : !bOid ? 'delete' : 'modify'
          })
        }
      }
    })
    
    return diffs
  }

  /**
   * Get current version state.
   */
  async getState(): Promise<VersionState> {
    const currentBranch = await git.currentBranch({ fs, dir: this.dir }) ?? 'HEAD'
    const head = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
    const status = await git.statusMatrix({ fs, dir: this.dir })
    
    const modifiedFiles = status
      .filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
      .map(([filepath]) => filepath as string)
    
    return {
      currentBranch,
      head,
      hasChanges: modifiedFiles.length > 0,
      modifiedFiles
    }
  }
}
```

### packages/shared/src/index.ts

```typescript
export { VersionManager } from './versions/manager'
```

---

## Part 4: Agent Version Tools (Main Agent)

### Update apps/electron/src/main/agent.ts

Add version control tools and update write_source to auto-commit:

```typescript
import { VersionManager } from '@anyapp/shared'

// Initialize version manager
const versionManager = new VersionManager(PROJECT_ROOT)

// Update write_source tool to auto-commit
tool(
  "write_source",
  "Write content to a source file (auto-commits to git)",
  {
    path: z.string().describe("Relative path to source file"),
    content: z.string().describe("New file content"),
    message: z.string().describe("Brief description of the change")
  },
  async ({ path, content, message }) => {
    const fullPath = resolve(PROJECT_ROOT, path)
    await fs.writeFile(fullPath, content)
    
    // Auto-commit
    const commit = await versionManager.commit({ message, files: [path] })
    
    return { 
      content: [{ 
        type: "text", 
        text: `Wrote ${path} (committed: ${commit.oid.slice(0,7)})` 
      }] 
    }
  }
),

// Add version control tools
tool(
  "version_create_branch",
  "Create a new branch for experimental changes",
  { name: z.string().describe("Branch name") },
  async ({ name }) => {
    await versionManager.createBranch({ name })
    return { content: [{ type: "text", text: `Created and switched to branch '${name}'` }] }
  }
),

tool(
  "version_switch_branch",
  "Switch to a different branch",
  { branchName: z.string().describe("Branch name to switch to") },
  async ({ branchName }) => {
    await versionManager.switchBranch(branchName)
    return { content: [{ type: "text", text: `Switched to branch '${branchName}'` }] }
  }
),

tool(
  "version_rollback",
  "Rollback to a previous commit",
  { commitId: z.string().describe("Commit SHA (first 7 chars ok)") },
  async ({ commitId }) => {
    await versionManager.rollback(commitId)
    return { content: [{ type: "text", text: `Rolled back to ${commitId}` }] }
  }
),

tool(
  "version_history",
  "Get commit history for current branch",
  { depth: z.number().optional().describe("Max commits (default 10)") },
  async ({ depth = 10 }) => {
    const history = await versionManager.getHistory({ depth })
    const formatted = history.map(c => 
      `- ${c.oid.slice(0,7)}: "${c.message}" (${c.timestamp})`
    ).join('\n')
    return { content: [{ type: "text", text: formatted }] }
  }
),

tool(
  "version_list_branches",
  "List all branches",
  {},
  async () => {
    const branches = await versionManager.listBranches()
    const formatted = branches.map(b => 
      `- ${b.name}${b.isCurrent ? ' (current)' : ''}`
    ).join('\n')
    return { content: [{ type: "text", text: formatted }] }
  }
),

tool(
  "version_merge",
  "Merge another branch into current",
  { branchName: z.string().describe("Branch to merge") },
  async ({ branchName }) => {
    const result = await versionManager.merge(branchName)
    if (result.success) {
      return { content: [{ type: "text", text: `Merged '${branchName}' successfully` }] }
    } else {
      return { content: [{ type: "text", text: `Merge conflicts detected` }] }
    }
  }
),

tool(
  "version_status",
  "Get current version control status",
  {},
  async () => {
    const state = await versionManager.getState()
    let status = `Branch: ${state.currentBranch}\nHEAD: ${state.head.slice(0,7)}`
    if (state.hasChanges) {
      status += `\nUncommitted: ${state.modifiedFiles.join(', ')}`
    }
    return { content: [{ type: "text", text: status }] }
  }
)
```

---

## Part 5: Version Control UI (Subagent A)

### apps/electron/src/renderer/src/components/VersionControl.tsx

```tsx
import { useState, useEffect } from 'react'
import type { Branch, Commit, VersionState } from '@anyapp/core'

interface VersionControlProps {
  onRollback: (commitId: string) => void
  onBranchSwitch: (branchName: string) => void
  onBranchCreate: (name: string) => void
}

export function VersionControl({ onRollback, onBranchSwitch, onBranchCreate }: VersionControlProps) {
  const [state, setState] = useState<VersionState | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [history, setHistory] = useState<Commit[]>([])
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)

  useEffect(() => {
    loadVersionData()
  }, [])

  const loadVersionData = async () => {
    // These would be IPC calls in real implementation
    // For now, show placeholder
  }

  return (
    <div className="flex flex-col h-full border-l bg-white">
      {/* Branch Selector */}
      <div className="p-3 border-b">
        <label className="text-sm font-medium text-neutral-500">Branch</label>
        <select 
          value={state?.currentBranch ?? 'main'}
          onChange={(e) => onBranchSwitch(e.target.value)}
          className="w-full mt-1 px-2 py-1.5 border rounded text-sm"
        >
          {branches.map(b => (
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
              className="flex-1 px-2 py-1 text-sm border rounded"
            />
            <button 
              onClick={() => {
                onBranchCreate(newBranchName)
                setNewBranchName('')
                setIsCreatingBranch(false)
              }}
              className="px-2 py-1 text-sm bg-blue-500 text-white rounded"
            >
              Create
            </button>
          </div>
        ) : (
          <button 
            onClick={() => setIsCreatingBranch(true)}
            className="mt-2 text-sm text-blue-500 hover:underline"
          >
            + New Branch
          </button>
        )}
      </div>

      {/* Status */}
      {state?.hasChanges && (
        <div className="p-3 border-b bg-yellow-50">
          <span className="text-sm text-yellow-700">
            {state.modifiedFiles.length} uncommitted change(s)
          </span>
        </div>
      )}

      {/* History Timeline */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <h3 className="text-sm font-medium text-neutral-500 mb-2">History</h3>
          <div className="space-y-2">
            {history.map((commit, i) => (
              <div 
                key={commit.oid}
                className="flex items-start gap-2 p-2 rounded hover:bg-neutral-50"
              >
                <div className="mt-1">
                  <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-neutral-300'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{commit.message}</p>
                  <p className="text-xs text-neutral-500">
                    {commit.oid.slice(0,7)} · {formatTime(commit.timestamp)}
                  </p>
                </div>
                {i > 0 && (
                  <button
                    onClick={() => onRollback(commit.oid)}
                    className="px-2 py-1 text-xs text-neutral-500 hover:text-blue-500 hover:bg-blue-50 rounded"
                    title="Rollback to this commit"
                  >
                    ↩️
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
}
```

### apps/electron/src/renderer/src/components/DiffViewer.tsx

```tsx
interface DiffViewerProps {
  oldContent: string
  newContent: string
  filename: string
}

export function DiffViewer({ oldContent, newContent, filename }: DiffViewerProps) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  
  return (
    <div className="font-mono text-sm">
      <div className="flex border-b bg-neutral-100 px-3 py-2">
        <span className="text-neutral-600">{filename}</span>
      </div>
      <div className="flex">
        {/* Old (left) */}
        <div className="flex-1 border-r">
          <div className="px-2 py-1 bg-red-50 text-red-700 text-xs">
            Previous
          </div>
          <pre className="p-2 overflow-x-auto">
            {oldLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 text-neutral-400 text-right pr-2 select-none">
                  {i + 1}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </pre>
        </div>
        
        {/* New (right) */}
        <div className="flex-1">
          <div className="px-2 py-1 bg-green-50 text-green-700 text-xs">
            Current
          </div>
          <pre className="p-2 overflow-x-auto">
            {newLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 text-neutral-400 text-right pr-2 select-none">
                  {i + 1}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  )
}
```

---

## Part 6: IPC for Version Control

### Add to apps/electron/src/main/ipc.ts

```typescript
import { VersionManager } from '@anyapp/shared'

const versionManager = new VersionManager(process.cwd())

// Version control IPC handlers
ipcMain.handle('version:get-state', () => versionManager.getState())
ipcMain.handle('version:get-branches', () => versionManager.listBranches())
ipcMain.handle('version:get-history', (_, depth?: number) => versionManager.getHistory({ depth }))
ipcMain.handle('version:switch-branch', (_, name: string) => versionManager.switchBranch(name))
ipcMain.handle('version:create-branch', (_, name: string) => versionManager.createBranch({ name }))
ipcMain.handle('version:rollback', (_, oid: string) => versionManager.rollback(oid))
ipcMain.handle('version:diff', (_, from: string, to: string) => versionManager.diff(from, to))
```

### Add to apps/electron/src/preload/index.ts

```typescript
// Version control
getVersionState: () => ipcRenderer.invoke('version:get-state'),
getBranches: () => ipcRenderer.invoke('version:get-branches'),
getHistory: (depth?: number) => ipcRenderer.invoke('version:get-history', depth),
switchBranch: (name: string) => ipcRenderer.invoke('version:switch-branch', name),
createBranch: (name: string) => ipcRenderer.invoke('version:create-branch', name),
rollback: (oid: string) => ipcRenderer.invoke('version:rollback', oid),
getDiff: (from: string, to: string) => ipcRenderer.invoke('version:diff', from, to),
```

---

## Verification Checklist

- [ ] `isomorphic-git` installed and importable
- [ ] VersionManager methods work correctly
- [ ] Agent can use version_* tools
- [ ] write_source auto-commits changes
- [ ] UI shows current branch and history
- [ ] Branch switching works
- [ ] Rollback restores file state
- [ ] Diff viewer shows changes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat: version control with isomorphic-git

- Add VersionManager wrapping isomorphic-git API
- Implement commit, branch, rollback, merge, diff
- Add agent tools for version control
- Auto-commit on write_source
- Add version control UI with timeline and branch switcher
- Add diff viewer component"
```

---

## Next Session

Proceed to **SESSION-4-SOURCES-SKILLS.md** for MCP and skills integration.
