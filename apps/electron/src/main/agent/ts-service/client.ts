/**
 * The main process's handle on one sub-app's TypeScript worker.
 *
 * Everything here is built around one rule: **this layer may never fail a caller.**
 * Diagnostics run inside the `tool_result` hook, which sits between the model's write
 * and the model seeing that the write succeeded. A code-intelligence layer that can
 * throw there, or hang there, is worse than no code intelligence at all — so a crashed
 * worker, an unparseable project, a timeout and a sub-app with no TypeScript in it all
 * arrive at the caller as the same thing: `unavailable`, which means *no information*,
 * never *a problem*.
 *
 * The worker is spawned through Electron's `utilityProcess` rather than
 * `child_process.fork`, because a packaged app ships no `node` binary. Its environment
 * is filtered by `buildSubprocessEnv` like every other spawn site Pi Taster owns.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { utilityProcess, type UtilityProcess } from 'electron'
import { buildSubprocessEnv } from '@pitaster/shared'
import type { ServiceRequest, ServiceResponse, WorkerResponseEnvelope } from './protocol'

/**
 * How long one request may take before the client gives up on it.
 *
 * Generous, because the *first* request pays for building the whole program and a
 * sub-app with React's type declarations installed takes seconds. Finite, because this
 * runs inside the agent's turn: a worker wedged on a pathological project must cost one
 * slow edit, not a turn that never ends.
 */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * How long a worker may sit unused before it is shut down.
 *
 * A warm program is the whole performance story, so this is long enough to span a
 * user reading a reply and typing the next prompt. It exists so that a session left
 * open overnight does not hold a program for every sub-app ever opened.
 */
const IDLE_TIMEOUT_MS = 10 * 60_000

/** Restarts allowed before the client stops trying for the rest of the session. */
const MAX_RESTARTS = 3

/** Absolute path to the built worker entry, beside this module's own bundle. */
const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'ts-worker.mjs')

/** A handle on one sub-app's language service. */
export interface TsServiceClient {
  /**
   * Ask the worker something.
   * @param request - The query
   * @returns The response, or `unavailable` when the service could not answer
   */
  request: (request: ServiceRequest) => Promise<ServiceResponse>
  /**
   * Start the worker and build its program, without waiting for the result.
   *
   * Called when a session opens so the first real query does not pay for the program
   * build inside the agent's turn.
   */
  warm: () => void
  /** Shut the worker down and refuse further requests. */
  dispose: () => void
}

/** A request waiting for its reply. */
interface Pending {
  /** Hand the response to the caller. */
  resolve: (response: ServiceResponse) => void
  /** The timeout that will give up on it. */
  timer: ReturnType<typeof setTimeout>
}

/**
 * Build a client for one sub-app.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The client handle
 */
export function createTsServiceClient(rootPath: string): TsServiceClient {
  let child: UtilityProcess | null = null
  let nextId = 1
  let restarts = 0
  let disposed = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<number, Pending>()

  const unavailable = (message: string): ServiceResponse => ({ kind: 'unavailable', message })

  /**
   * Fail every in-flight request, so no caller is left waiting on a dead worker.
   * @param message - Why the requests could not be answered
   */
  const settleAll = (message: string): void => {
    for (const [, waiting] of pending) {
      clearTimeout(waiting.timer)
      waiting.resolve(unavailable(message))
    }
    pending.clear()
  }

  const stop = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    child?.kill()
    child = null
  }

  const touchIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      // Nothing in flight by definition — a pending request keeps resetting this.
      stop()
    }, IDLE_TIMEOUT_MS)
  }

  /**
   * Start the worker if it is not already running.
   * @returns The running worker, or `null` when it could not be started
   */
  const ensure = (): UtilityProcess | null => {
    if (disposed) return null
    if (child) return child
    if (restarts > MAX_RESTARTS) return null

    try {
      child = utilityProcess.fork(WORKER_PATH, [rootPath], {
        env: buildSubprocessEnv(),
        // The worker parses source files and reports type errors. It has no reason to
        // reach the network, and saying so here means a compromised dependency in the
        // compiler's path cannot quietly do so either.
        stdio: 'ignore'
      })
    } catch (error) {
      child = null
      restarts += 1
      void error
      return null
    }

    child.on('message', (message: WorkerResponseEnvelope) => {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      clearTimeout(waiting.timer)
      waiting.resolve(
        message.response ?? unavailable(message.error ?? 'The language service failed.')
      )
    })

    child.on('exit', () => {
      child = null
      restarts += 1
      // A worker that dies with requests outstanding takes them with it. Answering
      // `unavailable` is what keeps the edit loop moving; the next request starts a
      // fresh worker, up to `MAX_RESTARTS`.
      settleAll('The language service stopped unexpectedly.')
    })

    return child
  }

  return {
    request: (request: ServiceRequest) =>
      new Promise<ServiceResponse>((resolve) => {
        const worker = ensure()
        if (!worker) {
          resolve(unavailable('The language service is not running.'))
          return
        }

        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          // Deliberately not a kill. A slow first program build is the common cause,
          // and killing the worker would throw away the work and make the *next*
          // request pay for it again.
          resolve(unavailable('The language service did not answer in time.'))
        }, REQUEST_TIMEOUT_MS)

        pending.set(id, { resolve, timer })
        touchIdle()
        worker.postMessage({ id, request })
      }),

    warm: () => {
      const worker = ensure()
      if (!worker) return
      // Any query builds the program; `invalidate` with no paths is the cheapest one
      // that does not also produce a result nobody asked for.
      const id = nextId++
      pending.set(id, {
        resolve: () => undefined,
        timer: setTimeout(() => pending.delete(id), REQUEST_TIMEOUT_MS)
      })
      touchIdle()
      worker.postMessage({ id, request: { kind: 'invalidate', paths: [] } })
    },

    dispose: () => {
      disposed = true
      settleAll('The session ended.')
      stop()
    }
  }
}
