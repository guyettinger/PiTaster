/**
 * What one live sub-app owns in the main process.
 *
 * Everything here used to be a module-level global in `ipc.ts`, implicitly bound
 * to whichever app was active — one agent host, one permission mode, one context
 * report, one telemetry recorder. That is the shape that makes a second open app
 * impossible, and it is also why an app switch had to dispose the host and forget
 * the conversation: with one slot, keeping A's state meant B could not have any.
 *
 * The registry is keyed by app id and, in this phase, holds at most one entry —
 * behaviour is unchanged. What changes is that the state has a *place*, so the
 * cap is a policy rather than a consequence of how the state is stored.
 *
 * `withWorkspace` is the reason this is a module rather than a few more globals:
 * it is the single funnel from a renderer-supplied app id to a confinement root,
 * so adding an id to sixty-odd channels does not add sixty-odd places for one to
 * become a path.
 */

import { isValidAppId } from '@keylimepi/shared'
import type { SubApp, PermissionMode, ContextReport } from '@keylimepi/core'
import type { AgentHost } from './agent/session'
import type { Telemetry } from './agent/telemetry'

/**
 * The live state of one open sub-app.
 */
export interface WorkspaceRuntime {
  /** The app this runtime belongs to. */
  readonly appId: string
  /** The live Pi session, or null before the first prompt. */
  host: AgentHost | null
  /** The chat session the host is bound to. */
  activeSessionId: string | null
  /**
   * How much the agent may do in this workspace.
   *
   * Per workspace rather than per process, and that is security-relevant rather
   * than tidy: it is read at every `tool_call` through `getPermissionMode()`, so
   * one global meant changing the mode in one app changed what another app's
   * in-flight turn was allowed to do.
   */
  permissionMode: PermissionMode
  /**
   * The last report built from a live session.
   *
   * Per conversation by construction. Holding it here also makes the old
   * `agentHost.appId === app.id` cross-check unrepresentable: a runtime's host
   * can only ever be its own.
   */
  cachedReport: ContextReport | null
  /** Per-turn request telemetry for this workspace's conversation. */
  telemetry: Telemetry
  /** Whether a turn is in flight. */
  runActive: boolean
  /**
   * Whether the host was built against configuration that has since changed.
   *
   * A settings, skills or sources save invalidates every host — each reads those
   * once, when it is built. Disposing a *busy* one to apply that would kill a
   * background turn because someone saved a setting, which is a worse failure
   * than a turn finishing under the old configuration. So the flag defers it:
   * the host is dropped at the end of the turn instead.
   */
  hostStale: boolean
  /**
   * When this workspace's host was last put to work, as `Date.now()`.
   *
   * The only input to eviction. A host is the expensive thing a workspace owns —
   * a Pi session, a transcript, and a whole `ts.LanguageService` program in its
   * own `utilityProcess` — so the cap is on hosts, and least-recently-used is
   * what decides which one goes.
   */
  lastUsedAt: number
}

/**
 * A validated workspace: an id that has become a real root, with its runtime.
 */
export interface Workspace {
  /** The app id, already proven to name a real app. */
  readonly id: string
  /** The app record. */
  readonly app: SubApp
  /** The confinement root every path check in this workspace is measured against. */
  readonly root: string
  /** The live state. */
  readonly runtime: WorkspaceRuntime
}

/** How a workspace resolves an app id to an app. */
type AppLookup = (id: string) => Promise<SubApp | null>

/** How a fresh telemetry recorder is made. */
type TelemetryFactory = () => Telemetry

/** Whether a workspace has an approval prompt on screen. */
type BusyCheck = (appId: string) => boolean

let lookupApp: AppLookup | null = null
let makeTelemetry: TelemetryFactory | null = null
let hasPendingApprovals: BusyCheck = () => false

/** Live runtimes, keyed by app id. */
const runtimes = new Map<string, WorkspaceRuntime>()

/**
 * The app the window is showing.
 *
 * All that survives of the old `activeAppId` as a *concept*: it answers "which
 * one is on screen", never "which one may this operation touch". Nothing that
 * resolves a path reads it.
 */
let focusedAppId: string | null = null

/**
 * Wire the registry to the app manager and telemetry.
 *
 * Injected rather than imported so this module stays free of `ipc.ts`, which
 * imports it — and so tests can drive it with a stub app manager instead of a
 * real apps directory.
 *
 * @param options - How to resolve an app, and how to make a telemetry recorder
 */
export function configureWorkspaces(options: {
  /** Resolve an app id to its record, or null when it names none. */
  lookupApp: AppLookup
  /** Make a fresh telemetry recorder for a new runtime. */
  createTelemetry: TelemetryFactory
  /**
   * Whether a workspace is waiting on an approval prompt.
   *
   * Injected because the prompts live in `ipc.ts`, and because eviction must not
   * take a host out from under a question the user is still looking at — the
   * answer would resolve into a session that no longer exists.
   */
  hasPendingApprovals?: BusyCheck
}): void {
  lookupApp = options.lookupApp
  makeTelemetry = options.createTelemetry
  hasPendingApprovals = options.hasPendingApprovals ?? (() => false)
}

/**
 * The default permission mode a new workspace starts in.
 *
 * `default` — prompt on every tool — because a workspace the user has not yet
 * configured must not inherit a permissive mode chosen for a different app.
 */
const INITIAL_PERMISSION_MODE: PermissionMode = 'default'

/**
 * The runtime for an app, created empty on first use.
 *
 * Deliberately cheap: no agent host, no model warm, no TypeScript service. That
 * is what lets a context report be built for a workspace that has never run a
 * turn without paging a 20GB model into memory to do it.
 *
 * @param appId - An id that has already been validated
 * @returns The live runtime
 */
function runtimeFor(appId: string): WorkspaceRuntime {
  const existing = runtimes.get(appId)
  if (existing) return existing

  if (!makeTelemetry) {
    throw new Error('Workspaces are not configured')
  }

  const created: WorkspaceRuntime = {
    appId,
    host: null,
    activeSessionId: null,
    permissionMode: INITIAL_PERMISSION_MODE,
    cachedReport: null,
    telemetry: makeTelemetry(),
    runActive: false,
    hostStale: false,
    lastUsedAt: Date.now()
  }
  runtimes.set(appId, created)
  return created
}

/**
 * Resolve a renderer-supplied app id to a live workspace, and run against it.
 *
 * The only function in main that turns an untrusted app id into a confinement
 * root. It does not implement the guard: `AppManager.getApp` routes through
 * `appDir`, which is the sandbox — an id must be one path segment resolving to a
 * *direct child* of the apps root, checked on the resolved path rather than
 * trusted from the character rule alone. Funnelling every channel through here
 * is what keeps that one guard covering all of them, instead of each handler
 * growing a check of its own that can drift.
 *
 * @param appId - The value the renderer sent, of unknown type
 * @param run - What to do with the resolved workspace
 * @returns Whatever `run` returns
 * @throws {Error} If the id is not a string, or names no app
 */
export async function withWorkspace<T>(
  appId: unknown,
  run: (workspace: Workspace) => Promise<T> | T
): Promise<T> {
  if (!lookupApp) {
    throw new Error('Workspaces are not configured')
  }
  if (typeof appId !== 'string') {
    throw new Error('Invalid app ID')
  }
  // Checked here as well as inside `getApp`, so the refusal is a refusal rather
  // than a "not found" — and so a lookup that is ever replaced by a cheaper one
  // cannot quietly drop the character rule.
  if (!isValidAppId(appId)) {
    throw new Error('Invalid app ID')
  }

  const app = await lookupApp(appId)
  if (!app) {
    throw new Error('Invalid app ID')
  }

  return run({ id: app.id, app, root: app.path, runtime: runtimeFor(app.id) })
}

/**
 * The workspace the window is showing, if any.
 *
 * For channels that genuinely have no app argument because they are about the
 * window rather than about an app. Anything that reads or writes a file takes an
 * id and goes through {@link withWorkspace}.
 *
 * @returns The focused workspace, or null when none is focused
 */
export async function focusedWorkspace(): Promise<Workspace | null> {
  if (focusedAppId === null) return null
  try {
    return await withWorkspace(focusedAppId, (workspace) => workspace)
  } catch {
    // The focused app was deleted from under us. Not an error — there is simply
    // no workspace to answer with.
    focusedAppId = null
    return null
  }
}

/**
 * Record which app the window is showing.
 * @param appId - The focused app, or null for none
 */
export function setFocusedAppId(appId: string | null): void {
  focusedAppId = appId
}

/** The focused app's id, or null. */
export function getFocusedAppId(): string | null {
  return focusedAppId
}

/**
 * Every live runtime.
 *
 * Used by the things that must reach *all* of them — a settings save invalidates
 * every workspace's host, not just the focused one.
 *
 * @returns The runtimes, in insertion order
 */
export function allRuntimes(): WorkspaceRuntime[] {
  return [...runtimes.values()]
}

/**
 * The runtime for an app, if it has one.
 *
 * Does not create. For callers that want to act on a workspace only when it is
 * already live — tearing one down, or asking whether a turn is running.
 *
 * @param appId - The app id
 * @returns Its runtime, or undefined
 */
export function existingRuntime(appId: string): WorkspaceRuntime | undefined {
  return runtimes.get(appId)
}

/**
 * The most workspaces that may hold a live agent host at once.
 *
 * Not the most workspaces: a runtime with no host is a few fields, and every
 * app-addressed channel creates one — reading a file from the Apps page must not
 * evict the session of the app you were just talking to. What is capped is the
 * expensive thing. Each live host holds a Pi session, its transcript, and a whole
 * `ts.LanguageService` program in its own `utilityProcess`, warmed on creation.
 *
 * Four, matching the rail's open-app cap, so a user who fills the rail never sees
 * eviction at all — it exists for the workspaces that are no longer on it.
 */
export const MAX_LIVE_HOSTS = 4

/**
 * Which hosts must be dropped to get back under the cap.
 *
 * Returns the runtimes to dispose, oldest first, and disposes nothing itself —
 * tearing a host down belongs to `ipc.ts`, which knows how. Three kinds of
 * workspace are never offered up, and each would be a distinct visible failure:
 * one mid-turn (the turn dies because someone opened a fourth app), one holding
 * an approval prompt (the answer resolves into a session that has gone), and the
 * one on screen (the meter drops to its floor while the user watches).
 *
 * @param protectAppId - The workspace being made live, which is never evicted
 * @returns Runtimes whose hosts should be disposed, least recently used first
 */
export function hostsToEvict(protectAppId: string | null): WorkspaceRuntime[] {
  const evictable = [...runtimes.values()]
    .filter((runtime) => runtime.host !== null)
    .filter(
      (runtime) =>
        runtime.appId !== protectAppId &&
        runtime.appId !== focusedAppId &&
        !runtime.runActive &&
        !hasPendingApprovals(runtime.appId)
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

  const live = [...runtimes.values()].filter((runtime) => runtime.host !== null).length
  // The workspace being made live is counted whether or not it has a host yet,
  // so the check is against the population *after* this one joins.
  const projected = protectAppId && !runtimes.get(protectAppId)?.host ? live + 1 : live
  const excess = projected - MAX_LIVE_HOSTS
  return excess > 0 ? evictable.slice(0, excess) : []
}

/**
 * Note that a workspace's host was just used.
 *
 * The only thing that moves a workspace up the eviction order, and it is called
 * where a host is *worked*, not where one is asked about — a context report read
 * on a panel mount says nothing about whether the conversation is still alive.
 *
 * @param runtime - The runtime whose host is being used
 */
export function touchRuntime(runtime: WorkspaceRuntime): void {
  runtime.lastUsedAt = Date.now()
}

/**
 * Forget a runtime entirely.
 *
 * The caller disposes the host first; this only drops the record. Called when an
 * app is deleted, and when the window goes away.
 *
 * @param appId - The app whose runtime to drop
 */
export function dropRuntime(appId: string): void {
  runtimes.delete(appId)
  if (focusedAppId === appId) focusedAppId = null
}

/** Drop every runtime. The caller disposes the hosts first. */
export function dropAllRuntimes(): void {
  runtimes.clear()
  focusedAppId = null
}
