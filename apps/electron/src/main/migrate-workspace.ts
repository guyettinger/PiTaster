/**
 * One-time migration of the workspace directory from the anyapp name to Pi Taster.
 *
 * The workspace holds everything the user owns that is not in this repository —
 * their sub-apps and the git history inside each one, their chat transcripts, their
 * skills, their config. The rebrand moves it from `~/.anyapp` to `~/.pitaster`, so
 * this runs before anything reads those paths and is the only thing standing between
 * an existing install and an app that opens empty.
 *
 * Two steps, in order:
 *
 * 1. **The directory.** A single `rename`, not a copy — it is one inode move within
 *    the home directory, so there is no window in which the data exists twice or half.
 * 2. **The per-app metadata file.** `.anyapp-meta.json` is *tracked* in each sub-app's
 *    git repo, so renaming it on disk alone would leave every app permanently dirty.
 *    The rename is committed in the same pass.
 *
 * Everything here is best-effort and non-fatal. This runs at startup, and a
 * migration that throws must not stop the window opening — the same reasoning
 * `setDockIcon` and `initializeSkills` already apply.
 */

import { readdir, rename, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { COMMIT_AUTHOR } from '@pitaster/shared'

/** The workspace directory's name before the Pi Taster rebrand. */
export const LEGACY_WORKSPACE_DIR = '.anyapp'

/** The workspace directory's name now. */
export const WORKSPACE_DIR = '.pitaster'

/** The per-app metadata file's name before the rebrand. */
export const LEGACY_META_FILE = '.anyapp-meta.json'

/** The per-app metadata file's name now. */
export const META_FILE = '.pitaster-meta.json'

/**
 * Parameters for {@link migrateWorkspace}.
 */
export interface MigrateWorkspaceParams {
  /** The pre-rebrand workspace root. Defaults to `~/.anyapp`. */
  legacyRoot?: string
  /** The current workspace root. Defaults to `~/.pitaster`. */
  root?: string
}

/**
 * What {@link migrateWorkspace} did.
 */
export interface MigrateWorkspaceResult {
  /** Whether the workspace directory itself was renamed on this run. */
  movedWorkspace: boolean
  /** App ids whose metadata file was renamed and committed on this run. */
  migratedApps: string[]
}

/**
 * Whether a path exists, of any type.
 *
 * @param path - The path to test
 * @returns True when something is there
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Renames one sub-app's metadata file and commits the rename.
 *
 * The commit matters as much as the rename. `initGitRepo` adds every file, so the
 * metadata file is tracked in the app's own repository; renaming it and stopping
 * would leave the app reporting uncommitted changes forever, and would put a
 * deletion the user never made in front of the next rollback.
 *
 * A repository that cannot be committed to — never initialised, or mid-rebase — is
 * not a reason to leave the file under its old name. The rename still happens; only
 * the commit is skipped.
 *
 * @param appPath - Absolute path to the sub-app root
 * @returns Whether the metadata file was renamed
 */
async function migrateAppMeta(appPath: string): Promise<boolean> {
  const legacyMeta = join(appPath, LEGACY_META_FILE)
  const meta = join(appPath, META_FILE)

  // Already migrated, or never an app directory at all.
  if (!(await exists(legacyMeta))) return false
  if (await exists(meta)) return false

  await rename(legacyMeta, meta)

  // An app directory with no repository is a legitimate state — a scaffold that
  // failed part-way, or a directory the user made by hand. The rename above is the
  // part that matters; there is simply nothing to commit it to.
  if (!(await exists(join(appPath, '.git')))) return true

  try {
    await git.remove({ fs, dir: appPath, filepath: LEGACY_META_FILE })
    await git.add({ fs, dir: appPath, filepath: META_FILE })
    await git.commit({
      fs,
      dir: appPath,
      message: 'chore: rename metadata file for the Pi Taster rebrand',
      author: COMMIT_AUTHOR
    })
  } catch (error) {
    console.error(`Could not commit the metadata rename in ${appPath}:`, error)
  }

  return true
}

/**
 * Moves everything under `from` that has no counterpart under `to`.
 *
 * The rule is **fill gaps, never overwrite**: an entry that already exists at the
 * destination is left exactly as it is, and two directories present on both sides are
 * recursed into rather than one replacing the other. So a file the user is currently
 * using can never be clobbered by a stale copy of itself.
 *
 * This exists because "the destination already exists" turned out to be a much weaker
 * signal than "the migration already ran". An empty `~/.pitaster/apps` is enough to
 * create the directory, and a refusal keyed on mere existence would then strand the
 * user's real workspace next door, permanently and silently — the app would open with
 * no apps, no history and no settings, and every later launch would repeat the
 * refusal. Filling the gaps is correct in that case and still safe in every other.
 *
 * @param from - The directory being emptied
 * @param to - The directory being filled
 */
async function moveMissingEntries(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)

    if (!(await exists(target))) {
      await rename(source, target)
      continue
    }

    // Present on both sides. Directories are merged one level deeper; a file that
    // exists at the destination is the live one and is left alone.
    if (entry.isDirectory()) {
      const targetStat = await stat(target)
      if (targetStat.isDirectory()) await moveMissingEntries(source, target)
    }
  }

  // Only succeeds when everything moved, which is exactly when it should.
  try {
    await rmdir(from)
  } catch {
    // Something was left behind because the destination already had it. That is the
    // intended outcome, not a failure — the directory stays as a record of it.
  }
}

/**
 * Moves the workspace to its post-rebrand name, if it has not moved already.
 *
 * Safe to call on every launch: once the legacy root is gone there is nothing to do,
 * and on a fresh install it never existed. Where the destination is absent this is a
 * single `rename`; where it exists, {@link moveMissingEntries} fills it in without
 * overwriting anything, so an empty or half-populated `~/.pitaster` cannot strand the
 * user's real data.
 *
 * @param params - Roots to migrate between; both default to the real home directory
 * @returns What was moved
 */
export async function migrateWorkspace(
  params: MigrateWorkspaceParams = {}
): Promise<MigrateWorkspaceResult> {
  const legacyRoot = params.legacyRoot ?? join(homedir(), LEGACY_WORKSPACE_DIR)
  const root = params.root ?? join(homedir(), WORKSPACE_DIR)

  const result: MigrateWorkspaceResult = { movedWorkspace: false, migratedApps: [] }

  if (await exists(legacyRoot)) {
    if (await exists(root)) {
      await moveMissingEntries(legacyRoot, root)
    } else {
      await rename(legacyRoot, root)
    }
    result.movedWorkspace = true
    console.log(`Migrated the workspace from ${legacyRoot} to ${root}`)
  }

  // Runs whether or not the directory moved on *this* launch: an earlier version
  // could have moved the directory and failed part-way through the apps.
  const appsDir = join(root, 'apps')
  let entries: string[]
  try {
    entries = await readdir(appsDir)
  } catch {
    return result
  }

  for (const id of entries) {
    try {
      if (await migrateAppMeta(join(appsDir, id))) result.migratedApps.push(id)
    } catch (error) {
      console.error(`Could not migrate the metadata file for app ${id}:`, error)
    }
  }

  return result
}
