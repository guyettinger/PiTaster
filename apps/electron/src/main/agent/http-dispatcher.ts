/**
 * Makes the HTTP idle timeout anyapp configures actually take effect.
 *
 * Pi exposes `httpIdleTimeoutMs` as a setting, but the only thing that enforces it is
 * `configureHttpDispatcher()`, which Pi calls from its own CLI, RPC and interactive
 * entry points — never from `core/sdk.ts`, the path anyapp embeds. It is not in Pi's
 * `exports` map either, so it cannot be reached from here. The setting therefore
 * reaches the OpenAI SDK's own `timeout` option and stops there.
 *
 * That leaves the real ceiling wherever Node's global dispatcher has it: undici
 * defaults `headersTimeout` and `bodyTimeout` to 300_000 ms. Ollama sends no response
 * headers until the first token, so a prefill longer than five minutes is aborted
 * mid-flight, the OpenAI SDK reports it as `APIConnectionTimeoutError: Request timed
 * out.`, and anyapp's retry policy repeats it — one initial attempt plus four
 * retries — for a twenty-five-minute failure. A large local model on a cold cache
 * passes five minutes routinely.
 *
 * `setGlobalDispatcher` reaches Node's built-in `fetch` even though that uses Node's
 * *internal* copy of undici: the dispatcher is stored on a well-known global symbol
 * both copies read. `install()` is not what makes the timeout apply, then — it keeps
 * `fetch` and the dispatcher on one undici implementation, without which a bundled
 * fetch can pull a compressed response through the npm dispatcher and never
 * decompress it, breaking `response.json()` in `agent/ollama.ts`.
 *
 * This mirrors Pi's own `configureHttpDispatcher`, reproduced here because anyapp
 * cannot call it.
 */

import { EventEmitter } from 'node:events'
import * as undici from 'undici'

/**
 * How long a request may go without producing bytes before it is aborted.
 *
 * Prefill on a large context is exactly that: minutes of silence with nothing on the
 * wire. `agent/stall-notifier.ts`, not this timeout, is what tells the user something
 * is still happening.
 *
 * Thirty minutes is not a guess at how long prefill takes; it is a bound loose enough
 * that tripping it means something is wrong rather than merely slow. A local daemon
 * has no request budget to protect, so the cost of setting this too high is only a
 * longer wait before a genuine hang is reported — while setting it too low kills work
 * that would have finished.
 *
 * This is the ceiling on one *request*. It does not bound a turn, because Pi retries
 * a timeout like any other transient error: `LOCAL_RETRY_ATTEMPTS` in `session.ts`
 * would multiply this into a two-and-a-half-hour turn. `TURN_RETRY_BUDGET_MS` in
 * `agent/retry-budget.ts` is what bounds that, and any change here has to be made
 * against it.
 */
export const HTTP_IDLE_TIMEOUT_MS = 1_800_000

/**
 * Node's default, which is the value this module exists to replace.
 *
 * Kept as documentation of what the ceiling silently was.
 */
export const NODE_DEFAULT_IDLE_TIMEOUT_MS = 300_000

/**
 * Undici's connection-attempt timeout.
 *
 * Node's own default is 250 ms, which can abandon a valid connection before the
 * daemon accepts it on a loaded machine.
 */
const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000

/** Whether {@link configureHttpDispatcher} has already run in this process. */
let configured = false

/**
 * Swallow the internal `error` event undici emits while tearing down an aborted body.
 *
 * The abort still surfaces to the caller through the body stream's rejection. This
 * only stops `EventEmitter`'s special case for unhandled `error` events from taking
 * the main process down with it — which now matters more, not less, because a long
 * prefill that trips the timeout is a normal outcome here.
 *
 * @param dispatcher - The dispatcher to attach the listener to
 * @returns The same dispatcher
 */
function ignoreTeardownErrors<T>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, 'error', () => {})
  }
  return dispatcher
}

/**
 * Build a `Client` that will not crash the process when it is torn down mid-stream.
 *
 * undici emits the teardown `error` on the pooled `Client`, not on the agent that
 * owns it, so a listener on the agent alone never sees it. This is the factory
 * `EnvHttpProxyAgent` and `Pool` use for the clients they create.
 *
 * Exported so a test can assert the listener is actually attached — the failure it
 * prevents is a process exit, which a test cannot safely provoke through the agent.
 *
 * @param origin - The origin the client serves
 * @param options - undici's client options
 * @returns The client, with the listener attached
 */
export function createClient(origin: string | URL, options: undici.Client.Options): undici.Client {
  return ignoreTeardownErrors(new undici.Client(origin, options))
}

/**
 * Build the per-origin dispatcher, which is a single `Client` or a `Pool` of them.
 *
 * @param origin - The origin to serve
 * @param options - undici's pool options
 * @returns A dispatcher for that origin, with the listener attached at every level
 */
export function createOriginDispatcher(
  origin: string | URL,
  options: undici.Pool.Options
): undici.Dispatcher {
  if (options.connections === 1) return createClient(origin, options)
  return ignoreTeardownErrors(new undici.Pool(origin, { ...options, factory: createClient }))
}

/**
 * Install a global undici dispatcher whose idle timeout matches anyapp's.
 *
 * Call once, before any agent session is created. Safe to call again; later calls are
 * ignored so a dispatcher is never swapped out from under an in-flight request.
 *
 * @param timeoutMs - Idle timeout in milliseconds. 0 disables it.
 * @returns Whether this call installed the dispatcher
 */
export function configureHttpDispatcher(timeoutMs: number = HTTP_IDLE_TIMEOUT_MS): boolean {
  if (configured) return false
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`)
  }

  const idle = Math.floor(timeoutMs)

  undici.setGlobalDispatcher(
    ignoreTeardownErrors(
      new undici.EnvHttpProxyAgent({
        allowH2: false,
        bodyTimeout: idle,
        headersTimeout: idle,
        connect: { autoSelectFamilyAttemptTimeout: AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS },
        // Without these the listener above reaches only the agent, and the `error`
        // undici raises on a pooled client while tearing down an aborted body is
        // unhandled — which ends the main process.
        clientFactory: createClient,
        factory: createOriginDispatcher
      })
    )
  )

  // Keeps `fetch` on the same undici as the dispatcher above. Optional call: older
  // undici releases do not export it, and the timeout applies without it.
  undici.install?.()

  configured = true
  return true
}
