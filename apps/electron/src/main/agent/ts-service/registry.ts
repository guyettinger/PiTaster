/**
 * One TypeScript language service per sub-app, shared by everything that needs it.
 *
 * The service started life inside `createAgentHost`, which was right while the agent was
 * its only consumer. The code panel is a second one, and it has to work when no chat
 * session exists — so the lifetime belongs to the *app*, not to the session.
 *
 * Sharing is the point, not an optimisation. The editor's squiggles and the errors
 * appended to the agent's writes have to come from the same program, or the user and the
 * model end up looking at two different accounts of whether the code compiles. A second
 * service would also mean a second copy of every type declaration in memory.
 *
 * Handles are reference counted: the agent session takes one for its lifetime and each
 * IPC caller takes one for the length of its call. The worker shuts down when the last
 * one is released, and its own idle timer covers the case where a handle is held but
 * unused.
 */

import { createTsServiceClient, type TsServiceClient } from './client'

/** A shared client plus the count of holders keeping it alive. */
interface Entry {
  /** The client itself. */
  client: TsServiceClient
  /** How many holders have not yet released. */
  holders: number
}

/** Live services, keyed by absolute sub-app root. */
const services = new Map<string, Entry>()

/** A borrowed service, which must be released. */
export interface TsServiceLease {
  /** The shared client. */
  client: TsServiceClient
  /** Give it back. Safe to call more than once. */
  release: () => void
}

/**
 * Borrow the language service for a sub-app, starting it if nobody has yet.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The lease
 */
export function acquireTsService(rootPath: string): TsServiceLease {
  const existing = services.get(rootPath)
  const entry: Entry = existing ?? { client: createTsServiceClient(rootPath), holders: 0 }
  entry.holders += 1
  services.set(rootPath, entry)

  let released = false
  return {
    client: entry.client,
    release: () => {
      if (released) return
      released = true
      entry.holders -= 1
      if (entry.holders > 0) return
      services.delete(rootPath)
      entry.client.dispose()
    }
  }
}

/**
 * Shut every service down.
 *
 * Called when the app quits. Without it the worker processes outlive the window, which
 * on macOS means an Electron helper still running after the dock icon has gone.
 */
export function disposeAllTsServices(): void {
  for (const [, entry] of services) entry.client.dispose()
  services.clear()
}
