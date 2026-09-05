/**
 * One-time migration of the workspace directory from the anyapp name to Pi Taster.
 *
 * The workspace holds everything the user owns that is not in this repository —
 * their sub-apps and the git history inside each one, their chat transcripts, their
 * skills, their config. The rebrand moves it from `~/.anyapp` to `~/.pitaster`, so
 * this runs before anything reads those paths and is the only thing standing between
 * an existing install and an app that opens empty.
 *
 * Five steps, in order:
 *
 * 1. **The directory.** A single `rename`, not a copy — it is one inode move within
 *    the home directory, so there is no window in which the data exists twice or half.
 * 2. **The per-app metadata file.** `.anyapp-meta.json` is *tracked* in each sub-app's
 *    git repo, so renaming it on disk alone would leave every app permanently dirty.
 *    The rename is committed in the same pass.
 * 3. **The chat transcripts.** Renaming the workspace directory is not enough to carry
 *    a conversation across, because Pi keys a session directory on the *absolute path*
 *    of the app it belongs to and records that path again inside every transcript. See
 *    {@link migrateAppSessions}: without this step every pre-rebrand chat is orphaned
 *    and the app opens each migrated sub-app with an empty history.
 * 4. **A missing `.gitignore`.** Apps scaffolded before there was a default have none,
 *    which makes their first `git_status` unusable. See {@link backfillGitignore}.
 * 5. **A stale active-session pointer.** See {@link repairSessionPointer}.
 *
 * Steps 2 to 5 run on every launch regardless of whether the directory moved on *this*
 * one: an earlier version of this file could have moved the directory and never done
 * the rest, which is exactly the state that prompted steps 3 to 5 being written.
 *
 * Everything here is best-effort and non-fatal, and each per-app step is guarded
 * separately so one failing app — or one failing step — cannot skip the others. This
 * runs at startup, and a migration that throws must not stop the window opening — the
 * same reasoning `setDockIcon` and `initializeSkills` already apply.
 */

import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { COMMIT_AUTHOR, DEFAULT_GITIGNORE, getAppSessionDir } from '@pitaster/shared'

/** The workspace directory's name before the Pi Taster rebrand. */
export const LEGACY_WORKSPACE_DIR = '.anyapp'

/** The workspace directory's name now. */
export const WORKSPACE_DIR = '.pitaster'

/** The per-app metadata file's name before the rebrand. */
export const LEGACY_META_FILE = '.anyapp-meta.json'

/** The per-app metadata file's name now. */
export const META_FILE = '.pitaster-meta.json'

/** Filename holding a sub-app's active-session pointer. Mirrors `ChatHistoryManager`. */
const ACTIVE_SESSION_FILE = '.chat-sessions.json'

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
  /** App ids that had orphaned transcripts moved into their current session directory. */
  migratedSessions: string[]
  /** App ids that were given the default `.gitignore` they were scaffolded without. */
  backfilledGitignore: string[]
  /** App ids whose active-session pointer named a session they do not have. */
  repairedPointers: string[]
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
 * Rewrites the app path recorded in a transcript's header.
 *
 * Pi's transcripts are JSONL whose first line is a `session` header carrying the `cwd`
 * the conversation ran in. That field is not decoration: `SessionManager.list` filters
 * a directory's transcripts to those whose header `cwd` resolves to the app it was
 * asked about, so a transcript whose header still names `~/.anyapp/apps/<id>` is
 * invisible even after it has been moved to the right directory.
 *
 * The filter is only skipped when the session directory is Pi's *own* default for that
 * cwd, and Pi Taster always passes `~/.pitaster/pi` where Pi would use `~/.pi/agent`.
 * So the filter is always on here, and rewriting the header is not optional.
 *
 * Only the `cwd` is touched, and only when it is exactly the path this app used to live
 * at. Every other byte of the file — the header's other fields, their order, and the
 * entire body — is preserved, because the body is the conversation and the ids in it
 * are what Pi's branch links resolve against.
 *
 * @param params - The file's text and the two app paths
 * @returns The rewritten text, or the input unchanged when there is nothing to rewrite
 */
export function rewriteTranscriptCwd(params: {
  /** The transcript's full text. */
  raw: string
  /** The app path the header is expected to name. */
  from: string
  /** The app path to record instead. */
  to: string
}): string {
  const breakAt = params.raw.indexOf('\n')
  const headerText = breakAt === -1 ? params.raw : params.raw.slice(0, breakAt)
  // Kept as a slice including the newline, so reassembly cannot change the body.
  const body = breakAt === -1 ? '' : params.raw.slice(breakAt)

  let header: Record<string, unknown>
  try {
    header = JSON.parse(headerText) as Record<string, unknown>
  } catch {
    // Not a transcript at all. Returning it unchanged means the caller still moves it:
    // a file nobody can parse is worth strictly more in the right directory than lost.
    return params.raw
  }

  if (header.type !== 'session') return params.raw
  if (typeof header.cwd !== 'string') return params.raw
  if (resolve(header.cwd) !== resolve(params.from)) return params.raw

  return `${JSON.stringify({ ...header, cwd: params.to })}${body}`
}

/**
 * Moves one transcript into its new session directory, rewriting its header on the way.
 *
 * Staged through a temporary name in the destination directory and renamed into place,
 * so a crash part-way through a write cannot leave a truncated transcript where Pi will
 * later look for a whole one. The source is removed only once the target is complete,
 * which makes the whole operation safe to interrupt and safe to repeat.
 *
 * @param params - Source and target files, and the two app paths
 */
async function moveTranscript(params: {
  /** The transcript's current path. */
  source: string
  /** Where it belongs. */
  target: string
  /** The app path its header is expected to name. */
  legacyAppPath: string
  /** The app path to record instead. */
  appPath: string
}): Promise<void> {
  const raw = await readFile(params.source, 'utf-8')
  const rewritten = rewriteTranscriptCwd({
    raw,
    from: params.legacyAppPath,
    to: params.appPath
  })

  const staging = `${params.target}.migrating`
  await writeFile(staging, rewritten, 'utf-8')
  await rename(staging, params.target)
  await rm(params.source, { force: true })
}

/**
 * Moves one app's pre-rebrand transcripts into the directory it now reads.
 *
 * This is the step that decides whether a migrated install opens with its chat history
 * or without it. Pi names a session directory after the absolute path of the app the
 * conversation belongs to — `~/.pitaster/pi/sessions/--Users-you-.anyapp-apps-x--` — so
 * moving `~/.anyapp` to `~/.pitaster` renamed the *app*, changed the slug Pi Taster
 * computes from it, and left every existing transcript filed under the old one. The app
 * then finds no sessions for the app and `apps:set-active` creates an empty one, which
 * is why the symptom reads as "my chats are gone" rather than as an error.
 *
 * The slug is computed with {@link getAppSessionDir} rather than spelled out here, so
 * the directory this reads is the same one `ChatHistoryManager` writes — the pair has
 * to agree, and a second copy of the encoding is a second thing to keep in step.
 *
 * Both directories live under the *current* agent directory: the transcripts moved with
 * the rest of the workspace, so only their names and headers are stale.
 *
 * **Fill gaps, never overwrite**, for the reason {@link moveMissingEntries} gives. A
 * filename embeds a uuid so a collision is not expected, but where one occurs the file
 * already in the live directory is the one being used.
 *
 * @param params - The agent directory and the app's old and new paths
 * @returns How many transcripts were moved
 */
async function migrateAppSessions(params: {
  /** The Pi agent directory, for example `~/.pitaster/pi`. */
  agentDir: string
  /** Where the app used to live, before the workspace was renamed. */
  legacyAppPath: string
  /** Where the app lives now. */
  appPath: string
}): Promise<number> {
  const from = getAppSessionDir({
    agentDir: params.agentDir,
    appPath: params.legacyAppPath
  })
  const to = getAppSessionDir({ agentDir: params.agentDir, appPath: params.appPath })

  // Nothing orphaned for this app — the ordinary case on every launch after the first.
  if (from === to) return 0

  let entries: string[]
  try {
    entries = await readdir(from)
  } catch {
    return 0
  }

  await mkdir(to, { recursive: true })

  let moved = 0
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue

    const source = join(from, name)
    const target = join(to, name)
    if (await exists(target)) continue

    try {
      await moveTranscript({
        source,
        target,
        legacyAppPath: params.legacyAppPath,
        appPath: params.appPath
      })
      moved += 1
    } catch (error) {
      console.error(`Could not migrate the transcript ${source}:`, error)
    }
  }

  // Only succeeds once everything moved, which is exactly when it should. Anything left
  // behind — a file that failed, a name the destination already had — keeps the
  // directory as the record of it.
  try {
    await rmdir(from)
  } catch {
    // Intended outcome, not a failure.
  }

  return moved
}

/**
 * Gives an app the default `.gitignore` if it has none.
 *
 * `DEFAULT_GITIGNORE` is a context measure, not a tidiness one, and an app scaffolded
 * before it existed never got one: `statusMatrix` reports an untracked file as changed,
 * so the agent's first `git_status` in such an app answers with every path under
 * `node_modules/` — measured at 2641 rows and about 160 KB on a real one, which is more
 * than the whole context window and a request that therefore cannot succeed.
 *
 * The file is committed for the reason {@link migrateAppMeta} commits its rename:
 * `initGitRepo` tracks everything, so leaving it untracked would have it report as a
 * change forever, which is the state being fixed.
 *
 * Writing it cannot untrack anything already committed, and deliberately does not try.
 * An app that has genuinely committed its dependencies is a different problem, and
 * rewriting someone's git history at startup is not a repair anyone asked for.
 *
 * An existing `.gitignore` is never touched, however little it covers — it is a file the
 * user and the agent can both edit, and the same restraint `seedSkills` applies.
 *
 * @param appPath - Absolute path to the sub-app root
 * @returns Whether a `.gitignore` was written
 */
async function backfillGitignore(appPath: string): Promise<boolean> {
  const target = join(appPath, '.gitignore')
  if (await exists(target)) return false

  await writeFile(target, DEFAULT_GITIGNORE, 'utf-8')

  if (!(await exists(join(appPath, '.git')))) return true

  try {
    await git.add({ fs, dir: appPath, filepath: '.gitignore' })
    await git.commit({
      fs,
      dir: appPath,
      message: 'chore: add the default .gitignore',
      author: COMMIT_AUTHOR
    })
  } catch (error) {
    console.error(`Could not commit the .gitignore in ${appPath}:`, error)
  }

  return true
}

/**
 * Clears an active-session pointer that names a session the app does not have.
 *
 * `.chat-sessions.json` is the one piece of chat state Pi Taster owns rather than Pi,
 * and nothing writing it has ever checked that the session belongs to the app being
 * written — `sessions:set-active` validated the id's shape and then trusted it. A click
 * on a session row that lands while the active app is changing therefore files one
 * app's session id under another app, and this install has exactly that: a magic-8-ball
 * session recorded as `pony-pony-pony`'s.
 *
 * `loadManifest` masks it on read, falling back to the most recent real session, so the
 * pointer stays wrong on disk indefinitely and no symptom ever surfaces. Clearing it
 * hands that same fallback the clean input it should have had.
 *
 * Ownership is decided by the transcript filename, which ends `_<session id>.jsonl`.
 * That keeps this free of Pi's `SessionManager` — a listing would apply the very cwd
 * filter the pass above exists to satisfy, so running it here would order the two steps
 * against each other for no gain.
 *
 * Runs *after* {@link migrateAppSessions} for that reason too: before it, every
 * pre-rebrand pointer names a session this app cannot yet see.
 *
 * @param params - The agent directory and the app's path
 * @returns Whether the pointer was cleared
 */
async function repairSessionPointer(params: {
  /** The Pi agent directory, for example `~/.pitaster/pi`. */
  agentDir: string
  /** Absolute path to the sub-app root. */
  appPath: string
}): Promise<boolean> {
  const pointerFile = join(params.appPath, ACTIVE_SESSION_FILE)

  let activeSessionId: string
  try {
    const parsed = JSON.parse(await readFile(pointerFile, 'utf-8')) as {
      activeSessionId?: unknown
    }
    if (typeof parsed.activeSessionId !== 'string' || parsed.activeSessionId === '') {
      return false
    }
    activeSessionId = parsed.activeSessionId
  } catch {
    // No pointer, or one nothing can parse. `readPointer` already treats both as "no
    // session selected", so there is nothing here to repair.
    return false
  }

  const sessionDir = getAppSessionDir({
    agentDir: params.agentDir,
    appPath: params.appPath
  })

  let entries: string[]
  try {
    entries = await readdir(sessionDir)
  } catch {
    // The app has no transcripts at all. The pointer cannot name one of its sessions,
    // but an app with no sessions is about to have one created and the pointer
    // overwritten, so rewriting it here would be noise.
    return false
  }

  if (entries.some((name) => name.endsWith(`_${activeSessionId}.jsonl`))) return false

  await writeFile(
    pointerFile,
    `${JSON.stringify({ activeSessionId: null }, null, 2)}\n`,
    'utf-8'
  )
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

  const result: MigrateWorkspaceResult = {
    movedWorkspace: false,
    migratedApps: [],
    migratedSessions: [],
    backfilledGitignore: [],
    repairedPointers: []
  }

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

  const agentDir = join(root, 'pi')

  for (const id of entries) {
    const appPath = join(appsDir, id)

    // What makes a directory under `apps/` an app is that it carries the metadata file
    // `AppManager` reads. Everything below writes into the app — a `.gitignore`, a
    // commit, a pointer — so a stray directory the user happens to keep here must be
    // left alone rather than quietly turned into something that looks like an app.
    const isApp =
      (await exists(join(appPath, META_FILE))) || (await exists(join(appPath, LEGACY_META_FILE)))

    try {
      if (await migrateAppMeta(appPath)) result.migratedApps.push(id)
    } catch (error) {
      console.error(`Could not migrate the metadata file for app ${id}:`, error)
    }

    if (!isApp) continue

    // Each step is guarded on its own. They are independent repairs of independent
    // defects, so an app whose transcripts cannot be moved should still get the
    // `.gitignore` that makes its `git_status` usable.
    try {
      const moved = await migrateAppSessions({
        agentDir,
        legacyAppPath: join(legacyRoot, 'apps', id),
        appPath
      })
      if (moved > 0) {
        result.migratedSessions.push(id)
        console.log(`Migrated ${moved} chat transcript(s) for app ${id}`)
      }
    } catch (error) {
      console.error(`Could not migrate the chat transcripts for app ${id}:`, error)
    }

    try {
      if (await backfillGitignore(appPath)) result.backfilledGitignore.push(id)
    } catch (error) {
      console.error(`Could not write a .gitignore for app ${id}:`, error)
    }

    try {
      if (await repairSessionPointer({ agentDir, appPath })) result.repairedPointers.push(id)
    } catch (error) {
      console.error(`Could not repair the active-session pointer for app ${id}:`, error)
    }
  }

  return result
}
