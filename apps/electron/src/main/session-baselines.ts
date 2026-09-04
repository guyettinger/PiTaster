/**
 * Where a chat session's work started from.
 *
 * The changed-files strip answers "what has this conversation touched?" as a git
 * diff, which needs a fixed end to measure from: the commit HEAD was at when the
 * session became active. Nothing else in the app records that. Pi's transcript
 * knows what was said, not what the repo looked like before it was said.
 *
 * It is kept beside `config.json` under `~/.pitaster` for the same reason layouts
 * are — see `layout-store.ts`. `.pitaster-meta.json` is the obvious home and the
 * wrong one: it is absent from `DEFAULT_GITIGNORE` and `AppManager.initGitRepo`
 * adds every file, so it is tracked and committed. A baseline stored there would
 * be rolled back by a rollback of the code, which destroys the exact reference
 * the rollback should be measured against.
 *
 * The store is deliberately dumb: an oid and a timestamp. It never holds a diff,
 * a path, or anything derived — all of that is recomputed from git on demand, so
 * a stale or corrupt store degrades to "no baseline" rather than to a wrong answer.
 */

import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * The commit one chat session started from.
 */
export interface StoredBaseline {
  /** The commit oid HEAD was at when the session became active. */
  head: string
  /** When it was recorded, ISO 8601. Used only to prune the oldest sessions. */
  recordedAt: string
}

/** Baselines, keyed by app id and then by session id. */
type BaselineStore = Record<string, Record<string, StoredBaseline>>

/**
 * The most sessions kept for one app.
 *
 * Sessions are created freely and never expire, so without a cap this file grows
 * for the life of the install. Fifty is far past what anyone scrolls back through
 * and still bounds the file at a few kilobytes per app. The oldest are dropped
 * first, which loses the baseline of a session nobody is looking at — its strip
 * then falls back to showing uncommitted work only.
 */
const MAX_SESSIONS_PER_APP = 50

/**
 * The longest id accepted as a key.
 *
 * The cap belongs here rather than only on the handler that happens to receive an
 * id, for the same reason `AppManager.appDir` validates an app id where it becomes
 * a path: this function is where every route converges. `changes:session-baseline`
 * bounds its argument, but a session id also arrives through `sessions:set-active`
 * and is replayed on every later app switch, so a bound checked only at one channel
 * is a bound the other channel does not have. Without it the "few kilobytes per
 * app" this module promises is whatever the renderer felt like sending.
 */
const MAX_ID_LENGTH = 256

/**
 * Refuse an id that cannot be a legitimate key.
 *
 * Throwing rather than silently skipping: the only callers are the IPC handler,
 * which validates first and so never trips this, and `captureSessionBaseline`,
 * which swallows and degrades the strip to "no baseline". Recording nothing is the
 * honest outcome for a session that cannot be identified — quietly returning an oid
 * nobody stored would have the strip measure against a baseline that does not exist.
 * @param appId - The app id being used as a key
 * @param sessionId - The session id being used as a key
 * @throws {Error} If either id is empty or longer than {@link MAX_ID_LENGTH}
 */
function assertUsableIds(appId: string, sessionId: string): void {
  for (const id of [appId, sessionId]) {
    if (id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw new Error('Invalid baseline key')
    }
  }
}

/**
 * Narrow one parsed entry to a usable baseline.
 *
 * The file is on disk and hand-editable, so nothing read back is trusted: a
 * malformed entry reads as absent, which every caller already handles.
 * @param value - The parsed entry
 * @returns The baseline, or null when the entry is not one
 */
function toBaseline(value: unknown): StoredBaseline | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as { head?: unknown; recordedAt?: unknown }
  if (typeof entry.head !== 'string' || entry.head.length === 0) return null
  return {
    head: entry.head,
    recordedAt: typeof entry.recordedAt === 'string' ? entry.recordedAt : ''
  }
}

/**
 * Read every stored baseline.
 * @param storePath - Absolute path to the baseline store file
 * @returns The store, or an empty one when it is missing or unreadable
 */
async function readStore(storePath: string): Promise<BaselineStore> {
  try {
    const data = await fs.readFile(storePath, 'utf-8')
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Object.create(null) as BaselineStore
    }
    const store: BaselineStore = Object.create(null) as BaselineStore
    for (const [appId, sessions] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) {
        continue
      }
      const kept: Record<string, StoredBaseline> = Object.create(null) as Record<
        string,
        StoredBaseline
      >
      for (const [sessionId, entry] of Object.entries(sessions as Record<string, unknown>)) {
        const baseline = toBaseline(entry)
        if (baseline) kept[sessionId] = baseline
      }
      if (Object.keys(kept).length > 0) store[appId] = kept
    }
    return store
  } catch {
    // Missing, or corrupt beyond parsing. The honest answer is that no session has
    // a baseline, and a strip with no baseline shows uncommitted work rather than
    // an error. Nobody can hand-repair this file, so it is never surfaced.
    return Object.create(null) as BaselineStore
  }
}

/**
 * Options for {@link readSessionBaseline}.
 */
export interface ReadSessionBaselineOptions {
  /** Absolute path to the baseline store file. */
  storePath: string
  /** The app the session belongs to. */
  appId: string
  /** The session whose baseline to read. */
  sessionId: string
}

/**
 * Read one session's baseline commit.
 * @param options - Where to read, and which session
 * @returns The commit oid, or null when the session has none
 */
export async function readSessionBaseline(
  options: ReadSessionBaselineOptions
): Promise<string | null> {
  const store = await readStore(options.storePath)
  return store[options.appId]?.[options.sessionId]?.head ?? null
}

/**
 * Options for {@link ensureSessionBaseline}.
 */
export interface EnsureSessionBaselineOptions {
  /** Absolute path to the baseline store file. */
  storePath: string
  /** The app the session belongs to. */
  appId: string
  /** The session to record a baseline for. */
  sessionId: string
  /** The commit oid to record, if the session does not already have one. */
  head: string
  /** App ids that still exist, used to prune the store as it is rewritten. */
  liveAppIds: readonly string[]
}

/**
 * Record a session's baseline, keeping the one already stored.
 *
 * **First write wins**, and that is the whole contract. Every caller passes the
 * *current* HEAD, so an implementation that overwrote would walk the baseline
 * forward on each call and the strip would report an empty session forever. The
 * answer has to be stable for the life of the session, which means the only
 * moment it can be decided is the first time anyone asks.
 *
 * Pruning happens here rather than in `deleteApp`, so deleting an app needs no
 * knowledge of baselines: a store that has outlived its apps corrects itself the
 * next time anything is written.
 * @param options - Where to write, which session, and the oid to record
 * @returns The session's baseline oid — the stored one when there was one
 */
export async function ensureSessionBaseline(
  options: EnsureSessionBaselineOptions
): Promise<string> {
  const { storePath, appId, sessionId, head, liveAppIds } = options
  assertUsableIds(appId, sessionId)

  const store = await readStore(storePath)
  const existing = store[appId]?.[sessionId]?.head
  if (existing) return existing

  const live = new Set(liveAppIds)
  // Null-prototype, because the two lines below assign through a *computed* key.
  // An object-literal computed property is inert for `__proto__`, but bracket
  // assignment is not — and this codebase's own rule is that an app id is the input
  // the whole boundary rests on. `generateId` cannot currently produce `__proto__`,
  // which makes this defence rather than a fix.
  const next: BaselineStore = Object.create(null) as BaselineStore
  for (const [id, sessions] of Object.entries(store)) {
    if (live.has(id)) next[id] = sessions
  }

  const sessions = {
    ...(next[appId] ?? {}),
    [sessionId]: { head, recordedAt: new Date().toISOString() }
  }

  // Newest first, then keep the head of the list. The tie-break is not optional:
  // several sessions opened inside one millisecond carry the same `recordedAt`,
  // and a stable sort would then preserve *insertion* order — oldest first — and
  // prune exactly the sessions it should keep. Position stands in for time when
  // the clock cannot tell them apart. An entry with no `recordedAt` (hand-edited,
  // or written by an older build) sorts last and is dropped first, which is the
  // right precedence for an entry that cannot say how old it is.
  const entries = Object.entries(sessions)
  const insertedAt = new Map(entries.map(([id], index) => [id, index]))
  entries.sort(([aId, a], [bId, b]) => {
    const byTime = b.recordedAt.localeCompare(a.recordedAt)
    return byTime !== 0 ? byTime : (insertedAt.get(bId) ?? 0) - (insertedAt.get(aId) ?? 0)
  })
  next[appId] = Object.fromEntries(entries.slice(0, MAX_SESSIONS_PER_APP))

  await fs.mkdir(join(storePath, '..'), { recursive: true })
  await fs.writeFile(storePath, JSON.stringify(next, null, 2))
  return head
}
