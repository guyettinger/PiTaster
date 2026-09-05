/**
 * Where a sub-app's workspace layout is kept.
 *
 * Per-app, but deliberately *not* in the app's own directory. `.keylimepi-meta.json`
 * is the obvious home and the wrong one: it is not in `DEFAULT_GITIGNORE`, and
 * `AppManager.initGitRepo` adds every file, so it is tracked and committed. In a
 * repo where every agent write auto-commits, a layout written on each drag would
 * mean a permanently dirty working tree, commit noise no one asked for, and —
 * worst — a rollback of the *code* also rolling back the *layout*. Where the
 * panels sit is not a fact about a commit.
 *
 * So layouts live beside `config.json` under `~/.keylimepi`, keyed by app id.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { serialized } from './serialize'

/**
 * A saved workspace layout for one sub-app.
 */
export interface StoredWorkspaceLayout {
  /** The schema version the layout was written against. */
  version: number
  /** dockview's own serialized tree. Opaque here. */
  layout: unknown
}

/** Saved layouts, keyed by app id. */
type LayoutStore = Record<string, StoredWorkspaceLayout>

/**
 * The largest layout accepted from the renderer, in bytes.
 *
 * The renderer is untrusted, and this value is the one thing standing between a
 * bug in the debounce and an unbounded file. A real layout with a few dozen open
 * files is a few kilobytes; a quarter of a megabyte is generous by two orders of
 * magnitude and still bounded.
 */
const MAX_LAYOUT_BYTES = 256 * 1024

/**
 * Read every saved layout.
 * @param storePath - Absolute path to the layout store file
 * @returns The store, or an empty one when it is missing or unreadable
 */
async function readStore(storePath: string): Promise<LayoutStore> {
  try {
    const data = await fs.readFile(storePath, 'utf-8')
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as LayoutStore
  } catch {
    // Missing, or corrupt beyond parsing. Either way the honest answer is that
    // there are no saved layouts — every caller falls back to the default, which
    // is a working workspace rather than an error.
    return {}
  }
}

/**
 * Options for {@link readWorkspaceLayout}.
 */
export interface ReadWorkspaceLayoutOptions {
  /** Absolute path to the layout store file. */
  storePath: string
  /** The app whose layout to read. */
  appId: string
  /** The schema version the renderer understands. */
  version: number
}

/**
 * Read one app's saved layout.
 *
 * A layout saved against a different schema version is discarded rather than
 * returned: the panel set it describes is not the one that would be restored.
 * @returns The serialized layout, or null when there is nothing usable
 */
export async function readWorkspaceLayout(
  options: ReadWorkspaceLayoutOptions
): Promise<unknown | null> {
  const store = await readStore(options.storePath)
  const entry = store[options.appId]
  if (!entry || typeof entry !== 'object') {
    return null
  }
  if (entry.version !== options.version) {
    return null
  }
  return entry.layout ?? null
}

/**
 * Options for {@link writeWorkspaceLayout}.
 */
export interface WriteWorkspaceLayoutOptions {
  /** Absolute path to the layout store file. */
  storePath: string
  /** The app whose layout to write. */
  appId: string
  /** The schema version being written. */
  version: number
  /** dockview's serialized tree. */
  layout: unknown
  /** App ids that still exist, used to prune the store as it is rewritten. */
  liveAppIds: readonly string[]
}

/**
 * Write one app's layout, pruning entries for apps that no longer exist.
 *
 * Pruning happens here rather than in `deleteApp` so that deleting an app needs
 * no knowledge of layouts at all — a store that has outlived its apps corrects
 * itself the next time anything is saved.
 * @throws {Error} If the layout is not a serializable object, or is too large
 */
export async function writeWorkspaceLayout(
  options: WriteWorkspaceLayoutOptions
): Promise<void> {
  const { storePath, appId, version, layout, liveAppIds } = options

  if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) {
    throw new Error('Invalid layout')
  }

  const encoded = JSON.stringify(layout)
  if (encoded === undefined) {
    throw new Error('Invalid layout')
  }
  if (Buffer.byteLength(encoded, 'utf-8') > MAX_LAYOUT_BYTES) {
    throw new Error('Layout too large')
  }

  // Validated before queueing, so a bad layout is refused now rather than after
  // waiting behind writes it was never going to join.
  //
  // Serialized from here down because everything below is a read-modify-write of
  // one file. Layouts are saved on every drag, and with several workspaces
  // mounted two apps' saves overlap: both would read the same pre-state and the
  // second would write the first app's layout back out of existence. Milder than
  // the baseline store's version of this — a lost drag, not a permanently empty
  // changed-files strip — but the same bug, and one line to close.
  return serialized(storePath, async () => {
    const store = await readStore(storePath)
    const live = new Set(liveAppIds)
    const next: LayoutStore = {}
    for (const [id, entry] of Object.entries(store)) {
      if (live.has(id)) {
        next[id] = entry
      }
    }
    next[appId] = { version, layout: JSON.parse(encoded) as unknown }

    await fs.mkdir(join(storePath, '..'), { recursive: true })
    await fs.writeFile(storePath, JSON.stringify(next, null, 2))
  })
}
