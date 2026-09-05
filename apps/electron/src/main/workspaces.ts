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

import { isValidAppId } from '@pitaster/shared'
import type { SubApp, PermissionMode, ContextReport } from '@pitaster/core'
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

let lookupApp: AppLookup | null = null
let makeTelemetry: TelemetryFactory | null = null

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
}): void {
  lookupApp = options.lookupApp
  makeTelemetry = options.createTelemetry
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
    runActive: false
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
 * The focused workspace's runtime, without a lookup.
 *
 * Synchronous, which is what lets the handlers that answer about "the current
 * app" stay synchronous. Safe because focus is only ever set through
 * {@link setFocusedAppId} by a caller that has already resolved the app through
 * {@link withWorkspace}, so a focused id always has a runtime.
 *
 * @returns The focused runtime, or null when no app is focused
 */
export function focusedRuntime(): WorkspaceRuntime | null {
  if (focusedAppId === null) return null
  return runtimes.get(focusedAppId) ?? null
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
