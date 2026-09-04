import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import type { SubApp, AppMetadata, CreateAppParams } from '@pitaster/core'
import { DEFAULT_GITIGNORE, getTemplate } from './templates.js'

const APPS_DIR = join(homedir(), '.pitaster', 'apps')
const AUTHOR = { name: 'Pi Taster Agent', email: 'agent@Pi Taster.local' }

/**
 * Whether a string can name a sub-app directory.
 *
 * An app id is a single directory name under {@link APPS_DIR}, and *every* path that
 * confines the agent is built by joining it — `SubApp.path` is the root
 * `permission-gate.ts` measures every tool argument against, and the path `deleteApp`
 * hands to a recursive `rm`. So an id that is not a single segment escapes everywhere
 * at once, and `join` is happy to help: `join(APPS_DIR, '../../../tmp')` resolves
 * outside the apps directory without complaint.
 *
 * The empty string is refused for a sharper reason than traversal. `generateId` strips
 * everything but `[a-z0-9-]`, so a name of `!!!` or `...` reduces to `''` — and
 * `join(APPS_DIR, '')` *is* `APPS_DIR`. An app created that way has the whole apps
 * directory as its root, and deleting it would take every other app with it. That needs
 * no attacker, only a user naming an app with punctuation.
 *
 * Deliberately not an allowlist mirroring `generateId`. Ids already on disk were written
 * by earlier versions of it, and a stricter rule would make a user's existing app vanish
 * from the listing rather than close a hole. Refusing non-segments is what closes it,
 * and {@link AppManager.appDir} re-checks the resolved path anyway.
 *
 * @param id - The candidate id, from anywhere
 * @returns Whether it names one directory inside the apps root
 */
export function isValidAppId(id: string): boolean {
  if (typeof id !== 'string') return false
  if (id.length === 0 || id.length > 255) return false
  if (id === '.' || id === '..') return false

  // `:` is refused for Windows, where `apps/cache:bin` addresses the `bin` alternate
  // data stream of a sibling `cache` entry rather than a directory. It stays inside the
  // apps root either way, so this is not the traversal rule — it is refusing an
  // addressing mode nothing here wants. `generateId` never produces one.
  return !/[/\\:\0]/.test(id)
}

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

    return apps.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /**
   * Resolve one sub-app's directory, or null if the id does not name one.
   *
   * The single place an id becomes a path. The resolved path is re-checked against the
   * apps root rather than trusted from {@link isValidAppId} alone: the character rule
   * and the containment rule can drift apart, and only the second one is the thing
   * actually being promised.
   *
   * @param id - The app id
   * @returns The absolute directory, or null when the id does not name one
   */
  private appDir(id: string): string | null {
    if (!isValidAppId(id)) return null

    const root = resolve(APPS_DIR)
    const appPath = resolve(root, id)

    // A direct child, not merely a descendant. Sub-apps are never nested.
    return dirname(appPath) === root ? appPath : null
  }

  /**
   * Get a single sub-app by ID.
   *
   * An id that does not name a directory inside the apps root reads as "not found"
   * rather than throwing, which is the answer callers already handle — and it is
   * true. Every mutating method goes through here first, so this is also what keeps
   * `deleteApp` from being pointed at somewhere else.
   *
   * @param id - The app id
   * @returns The app, or null when there is no such app
   */
  async getApp(id: string): Promise<SubApp | null> {
    const appPath = this.appDir(id)
    if (!appPath) return null

    const metaPath = join(appPath, '.pitaster-meta.json')

    try {
      const metaContent = await readFile(metaPath, 'utf-8')
      const meta: AppMetadata = JSON.parse(metaContent)

      // Get git status
      let currentBranch: string | undefined
      let hasChanges = false

      try {
        currentBranch = (await git.currentBranch({ fs, dir: appPath })) ?? undefined
        const status = await git.statusMatrix({ fs, dir: appPath })
        hasChanges = status.some(
          ([, head, workdir, stage]) => head !== workdir || head !== stage
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
   * Create a new sub-app from template.
   */
  async createApp(params: CreateAppParams): Promise<SubApp> {
    // Validate before creating anything. `ensureAppsDir` used to run first, which
    // meant a call that was going to be refused still created the apps root as a
    // side effect — enough to make a refusal test leave a directory in the real home
    // directory, and enough for an empty apps root to appear before any app exists.
    const id = this.generateId(params.name)
    const appPath = this.appDir(id)
    if (!appPath) {
      // Reached by a name with no alphanumerics at all — `!!!`, `...`, whitespace —
      // which `generateId` reduces to an empty id. Refusing it here is what stops an
      // app being created with the whole apps directory as its root.
      throw new Error(
        `App name "${params.name}" does not contain enough letters or digits to name a folder.`
      )
    }

    // Check if already exists
    const existing = await this.getApp(id)
    if (existing) {
      throw new Error(`App with ID "${id}" already exists`)
    }

    // Create directory
    await this.ensureAppsDir()
    await mkdir(appPath, { recursive: true })

    // Get template config
    const template = getTemplate(params.template)

    // Seed .gitignore before the template's own files, so a template that ships one
    // overwrites this default rather than being overwritten by it.
    if (!template.files.some((file) => file.path === '.gitignore')) {
      await writeFile(join(appPath, '.gitignore'), DEFAULT_GITIGNORE)
    }

    // Create files from template
    for (const file of template.files) {
      const filePath = join(appPath, file.path)
      const fileDir = join(filePath, '..')
      await mkdir(fileDir, { recursive: true })

      // Replace template variables
      const content = file.content
        .replace(/\{\{APP_NAME\}\}/g, params.name)
        .replace(/\{\{APP_DESCRIPTION\}\}/g, params.description ?? '')
        .replace(/\{\{APP_ID\}\}/g, id)

      await writeFile(filePath, content)
    }

    // Create package.json if template has dependencies/scripts
    if (template.dependencies || template.devDependencies || template.scripts) {
      const packageJson = {
        name: id,
        version: '0.1.0',
        description: params.description ?? '',
        type: 'module',
        scripts: template.scripts ?? {},
        dependencies: template.dependencies ?? {},
        devDependencies: template.devDependencies ?? {}
      }
      await writeFile(join(appPath, 'package.json'), JSON.stringify(packageJson, null, 2))
    }

    // Create metadata
    const now = new Date().toISOString()
    const meta: AppMetadata = {
      id,
      name: params.name,
      description: params.description ?? '',
      template: params.template,
      status: 'ready',
      createdAt: now,
      updatedAt: now
    }
    await this.writeMetadata(appPath, meta)

    // Initialize git
    await this.initGitRepo(appPath, `Initial commit: ${params.name}`)

    return (await this.getApp(id))!
  }

  /**
   * Update app metadata.
   *
   * Every field is carried forward explicitly rather than spread, because `SubApp`
   * carries three fields that are derived at read time — `path`, `currentBranch` and
   * `hasChanges` — and writing those into the metadata file would persist a stale copy
   * of the git state. The cost is that a new persisted field has to be added here too;
   * leaving one out silently drops it on the next rename.
   *
   * @param id - The app to update
   * @param updates - The fields to change
   * @returns The app, re-read from disk
   * @throws {Error} If no app has that id
   */
  async updateApp(
    id: string,
    updates: Partial<Pick<SubApp, 'name' | 'description' | 'disabledSkills'>>
  ): Promise<SubApp> {
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
      updatedAt: new Date().toISOString(),
      disabledSkills: updates.disabledSkills ?? app.disabledSkills
    }

    await writeFile(join(app.path, '.pitaster-meta.json'), JSON.stringify(meta, null, 2))

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
          files.push(...(await this.getAllFiles(fullPath)))
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
    await writeFile(join(appPath, '.pitaster-meta.json'), JSON.stringify(meta, null, 2))
  }
}
