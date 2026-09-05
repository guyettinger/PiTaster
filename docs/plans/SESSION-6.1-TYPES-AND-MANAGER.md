# Session 6.1: Sub-App Types and AppManager

## Overview

This sub-session adds the core type definitions and AppManager class for sub-app lifecycle management.

**Estimated scope**: Small  
**Prerequisites**: Session 5 complete  
**Deliverable**: Type definitions and basic AppManager (without templates)

## Objectives

1. Add sub-app type definitions to `packages/core`
2. Create AppManager class for CRUD operations
3. Set up the apps directory structure

---

## Task 1: Type Definitions

### Create packages/core/src/apps.ts

```typescript
/**
 * Sub-app template types for scaffolding new apps.
 */
export type AppTemplate = 
  | 'react-vite'
  | 'node-cli'
  | 'node-server'
  | 'static-site'
  | 'blank'

/**
 * Sub-app status.
 */
export type AppStatus = 
  | 'ready'
  | 'creating'
  | 'error'
  | 'building'

/**
 * Sub-app definition.
 */
export interface SubApp {
  /** Unique identifier (directory name). */
  id: string
  /** Display name. */
  name: string
  /** Brief description. */
  description: string
  /** Template used to create the app. */
  template: AppTemplate
  /** Current status. */
  status: AppStatus
  /** Absolute path to app directory. */
  path: string
  /** ISO timestamp when created. */
  createdAt: string
  /** ISO timestamp when last modified. */
  updatedAt: string
  /** Current git branch. */
  currentBranch?: string
  /** Whether app has uncommitted changes. */
  hasChanges?: boolean
}

/**
 * Parameters for creating a new sub-app.
 */
export interface CreateAppParams {
  /** Display name for the app. */
  name: string
  /** Brief description. */
  description?: string
  /** Template to use. */
  template: AppTemplate
}

/**
 * App context for scoped agent operations.
 */
export interface AppContext {
  /** The active sub-app, or null if no app selected. */
  activeApp: SubApp | null
  /** Root path for agent file operations. */
  rootPath: string
}

/**
 * Metadata stored in .keylimepi-meta.json
 */
export interface AppMetadata {
  id: string
  name: string
  description: string
  template: AppTemplate
  status: AppStatus
  createdAt: string
  updatedAt: string
}
```

### Update packages/core/src/index.ts

Add the export:

```typescript
export * from './apps'
```

---

## Task 2: AppManager Base Class

### Create packages/shared/src/apps/manager.ts

```typescript
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import type { SubApp, CreateAppParams, AppMetadata } from '@keylimepi/core'

const APPS_DIR = join(homedir(), '.Key Lime Pi', 'apps')
const AUTHOR = { name: 'Key Lime Pi Agent', email: 'agent@keylimepi.local' }

/**
 * Manages sub-app lifecycle: creation, listing, deletion, and metadata.
 */
export class AppManager {
  /**
   * Ensure the apps directory exists.
   */
  async ensureAppsDir(): Promise<void> {
    await mkdir(APPS_DIR, { recursive: true })
  }

  /**
   * Get the apps directory path.
   */
  getAppsDir(): string {
    return APPS_DIR
  }

  /**
   * List all sub-apps.
   */
  async listApps(): Promise<SubApp[]> {
    await this.ensureAppsDir()
    
    const entries = await readdir(APPS_DIR, { withFileTypes: true })
    const apps: SubApp[] = []
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const app = await this.getApp(entry.name)
        if (app) apps.push(app)
      }
    }
    
    return apps.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /**
   * Get a single sub-app by ID.
   */
  async getApp(id: string): Promise<SubApp | null> {
    const appPath = join(APPS_DIR, id)
    const metaPath = join(appPath, '.keylimepi-meta.json')
    
    try {
      const metaContent = await readFile(metaPath, 'utf-8')
      const meta: AppMetadata = JSON.parse(metaContent)
      
      // Get git status
      let currentBranch: string | undefined
      let hasChanges = false
      
      try {
        currentBranch = await git.currentBranch({ fs, dir: appPath }) ?? undefined
        const status = await git.statusMatrix({ fs, dir: appPath })
        hasChanges = status.some(([, head, workdir, stage]) => 
          head !== workdir || head !== stage
        )
      } catch {
        // Git not initialized yet
      }
      
      return {
        ...meta,
        path: appPath,
        currentBranch,
        hasChanges
      }
    } catch {
      return null
    }
  }

  /**
   * Delete a sub-app.
   */
  async deleteApp(id: string): Promise<void> {
    const app = await this.getApp(id)
    if (!app) {
      throw new Error(`App "${id}" not found`)
    }
    
    await rm(app.path, { recursive: true, force: true })
  }

  /**
   * Update app metadata.
   */
  async updateApp(id: string, updates: Partial<Pick<SubApp, 'name' | 'description'>>): Promise<SubApp> {
    const app = await this.getApp(id)
    if (!app) {
      throw new Error(`App "${id}" not found`)
    }
    
    const meta: AppMetadata = {
      id: app.id,
      name: updates.name ?? app.name,
      description: updates.description ?? app.description,
      template: app.template,
      status: app.status,
      createdAt: app.createdAt,
      updatedAt: new Date().toISOString()
    }
    
    await writeFile(
      join(app.path, '.keylimepi-meta.json'),
      JSON.stringify(meta, null, 2)
    )
    
    return (await this.getApp(id))!
  }

  /**
   * Generate URL-safe ID from name.
   */
  generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
  }

  /**
   * Get all files in directory recursively (excluding .git and node_modules).
   */
  async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          files.push(...await this.getAllFiles(fullPath))
        }
      } else {
        files.push(fullPath)
      }
    }
    
    return files
  }

  /**
   * Initialize git repository for an app.
   */
  async initGitRepo(appPath: string, initialMessage: string): Promise<void> {
    await git.init({ fs, dir: appPath, defaultBranch: 'main' })
    
    const files = await this.getAllFiles(appPath)
    for (const file of files) {
      const relativePath = file.replace(appPath + '/', '')
      await git.add({ fs, dir: appPath, filepath: relativePath })
    }
    
    await git.commit({
      fs,
      dir: appPath,
      message: initialMessage,
      author: AUTHOR
    })
  }

  /**
   * Write metadata file for an app.
   */
  async writeMetadata(appPath: string, meta: AppMetadata): Promise<void> {
    await writeFile(
      join(appPath, '.keylimepi-meta.json'),
      JSON.stringify(meta, null, 2)
    )
  }
}
```

### Create packages/shared/src/apps/index.ts

```typescript
export { AppManager } from './manager'
```

### Update packages/shared/src/index.ts

Add the export:

```typescript
export { AppManager } from './apps/manager'
```

---

## Verification Checklist

- [ ] `packages/core/src/apps.ts` created with all types
- [ ] `packages/core/src/index.ts` exports apps
- [ ] `packages/shared/src/apps/manager.ts` created
- [ ] `packages/shared/src/apps/index.ts` created
- [ ] `packages/shared/src/index.ts` exports AppManager
- [ ] `bun run typecheck:all` passes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.1): add sub-app types and AppManager base

- Add SubApp, AppTemplate, CreateAppParams types to @keylimepi/core
- Create AppManager with list, get, delete, update operations
- Add git repo initialization helper
- Set up ~/.keylimepi/apps/ directory structure"
```

---

## Next

Proceed to **SESSION-6.2-APP-TEMPLATES.md** to add app scaffolding templates.
