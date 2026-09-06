/**
 * Which sub-apps are open in the rail, and which one has focus.
 *
 * This is the shell's own state, not an app's: it says what the *window* was
 * showing, and it must survive a restart the way an editor's open tabs do.
 *
 * It lives beside `config.json` under `~/.keylimepi` for the same reason layouts
 * do, and the reason is sharper here. `.keylimepi-meta.json` is tracked and
 * `AppManager.initGitRepo` adds every file, so a set kept there would be
 * committed on every focus change — and a rollback of an app's *code* would roll
 * back which apps were open, which is not a fact about a commit.
 *
 * @see layout-store.ts, which this deliberately mirrors.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import type { OpenAppsState } from '@keylimepi/core'

/**
 * The most apps that may be open at once.
 *
 * Not a taste: from Phase 5 each open app holds a live Pi session, a transcript
 * and a whole `ts.LanguageService` program in its own `utilityProcess`. The cap
 * is enforced here as well as in the renderer because this file is what the next
 * launch restores from, and an oversized set written by a buggy renderer would
 * otherwise be replayed into that many live workspaces on startup.
 */
export const MAX_OPEN_APPS = 4

/** The empty set, returned whenever the store cannot be trusted. */
const EMPTY: OpenAppsState = { openAppIds: [], focusedAppId: null }

/**
 * Read the open-app set, dropping anything that no longer exists.
 *
 * Pruning on read rather than trusting the file is what makes an app deleted
 * outside the app — or a store written by an older version — heal instead of
 * leaving a tile that opens nothing.
 *
 * @param options - Where to read from, and which apps are real
 * @returns The set, filtered to live apps and capped
 */
export async function readOpenApps(options: {
  /** Absolute path to the store file. */
  storePath: string
  /** App ids that still exist. */
  liveAppIds: readonly string[]
}): Promise<OpenAppsState> {
  const { storePath, liveAppIds } = options

  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(storePath, 'utf-8'))
  } catch {
    // Missing, or corrupt beyond parsing. The honest answer is that no apps are
    // open — which is a working shell showing the app library, not an error.
    return EMPTY
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return EMPTY
  }

  const raw = parsed as Partial<OpenAppsState>
  const live = new Set(liveAppIds)
  const openAppIds = Array.isArray(raw.openAppIds)
    ? raw.openAppIds
        .filter((id): id is string => typeof id === 'string' && live.has(id))
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, MAX_OPEN_APPS)
    : []

  // A focused id that is not in the open set is not focus, it is a dangling
  // pointer — the rail would highlight nothing and the workspace would mount an
  // app with no tile.
  const focusedAppId =
    typeof raw.focusedAppId === 'string' && openAppIds.includes(raw.focusedAppId)
      ? raw.focusedAppId
      : null

  return { openAppIds, focusedAppId }
}

/**
 * Write the open-app set.
 *
 * Validates rather than trusts: the renderer is untrusted, and this file is
 * replayed on the next launch, so a bad write here is a bad startup later.
 *
 * @param options - Where to write, what to write, and which apps are real
 * @throws {Error} If the state is not the shape it claims to be
 */
export async function writeOpenApps(options: {
  /** Absolute path to the store file. */
  storePath: string
  /** The state to persist. */
  state: OpenAppsState
  /** App ids that still exist, used to prune as the store is rewritten. */
  liveAppIds: readonly string[]
}): Promise<void> {
  const { storePath, state, liveAppIds } = options

  if (typeof state !== 'object' || state === null || !Array.isArray(state.openAppIds)) {
    throw new Error('Invalid open apps state')
  }
  if (state.openAppIds.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid open apps state')
  }
  if (state.focusedAppId !== null && typeof state.focusedAppId !== 'string') {
    throw new Error('Invalid open apps state')
  }

  const live = new Set(liveAppIds)
  const openAppIds = state.openAppIds
    .filter((id) => live.has(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, MAX_OPEN_APPS)
  const focusedAppId =
    state.focusedAppId !== null && openAppIds.includes(state.focusedAppId)
      ? state.focusedAppId
      : null

  await fs.mkdir(join(storePath, '..'), { recursive: true })
  await fs.writeFile(storePath, JSON.stringify({ openAppIds, focusedAppId }, null, 2))
}
