/**
 * The settings Pi Taster layers over Pi's, and the loader that makes them stick.
 *
 * Split out of `session.ts` so it can be tested: `session.ts` reaches `electron`
 * transitively, so the suite cannot import it, and this seam is precisely the one
 * that failed silently for a fortnight.
 */

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ContextBudget } from './context-budget'
import { HTTP_IDLE_TIMEOUT_MS } from './http-dispatcher'

/**
 * The settings shape `SettingsManager.applyOverrides` accepts.
 *
 * Pi does not export its `Settings` interface from the package root, so it is read
 * back off the method that consumes it. That also means this stays correct if Pi
 * changes the shape.
 */
export type PiSettingsOverrides = Parameters<SettingsManager['applyOverrides']>[0]

/**
 * Retries Pi should make when the local daemon fails a request.
 *
 * A local daemon fails differently from a hosted API: no rate limits, but connection
 * refused while it restarts, a 500 when it runs out of memory, and long stalls while
 * it swaps another model out. Those recover in seconds, so a handful of attempts with
 * a couple of seconds between them is the right shape.
 *
 * Pi issues one initial attempt plus this many retries, and it cannot tell those fast
 * failures from a request that hung for the whole of `HTTP_IDLE_TIMEOUT_MS` — so the
 * count alone would allow a five-hour turn. `agent/retry-budget.ts` bounds the
 * SILENCE instead, which is what keeps this number free to serve the case it was
 * chosen for.
 */
const LOCAL_RETRY_ATTEMPTS = 4

/** Backoff base. Pi doubles this per attempt. */
const LOCAL_RETRY_BASE_DELAY_MS = 2000

// `HTTP_IDLE_TIMEOUT_MS` lives in `./http-dispatcher`, next to the dispatcher that
// enforces the streaming half of it. Pi DOES read this setting on the path Pi Taster
// uses — `streamFn` resolves `getHttpIdleTimeoutMs()` and hands it to the OpenAI SDK
// as that request's `timeout` — so it is the bound on how long prefill may run before
// a request is abandoned. It reached Pi only once the overrides stopped being wiped;
// see `PiTasterResourceLoader`.

/**
 * Translate a context budget into the Pi settings that enforce it.
 *
 * Pi's own `DEFAULT_COMPACTION_SETTINGS` reserves 16384 tokens and retains 20000 —
 * 36k of budget, which is more than the whole window on the models Pi Taster targets.
 * Left alone it either never compacts or compacts in a loop.
 *
 * Provider-level retries are disabled deliberately. Pi's own retry policy is the one
 * that emits `auto_retry_*` events; retries underneath it are invisible and turn a
 * recoverable failure into a longer, unexplained wait.
 *
 * @param budget - The resolved context budget for this session's model
 * @returns Settings to layer over Pi's own, without persisting them
 */
export function buildPiSettings(budget: ContextBudget): PiSettingsOverrides {
  return {
    compaction: budget.compaction,
    retry: {
      enabled: true,
      maxRetries: LOCAL_RETRY_ATTEMPTS,
      baseDelayMs: LOCAL_RETRY_BASE_DELAY_MS,
      provider: { maxRetries: 0 }
    },
    httpIdleTimeoutMs: HTTP_IDLE_TIMEOUT_MS
  }
}

/**
 * A resource loader that puts Pi Taster's settings back after every reload.
 *
 * `SettingsManager.applyOverrides` is not durable: `reload()` recomputes `settings`
 * from the global and project files alone, and there is no settings file, so every
 * override Pi Taster applied became `{}` and Pi fell back to its own defaults. Applying
 * them before `createAgentHost`'s own `loader.reload()` was therefore applying them
 * to a value about to be discarded — one reload was all it took.
 *
 * Overriding `reload` rather than re-applying at the one call site is deliberate:
 * `DefaultResourceLoader.reload` can reload settings more than once internally (it
 * does when resolving project trust), and any future caller — an extension reload, a
 * `createAgentSession` that is not handed a loader — gets the repair for free.
 *
 * That cost the three decisions `buildPiSettings` exists to make. The visible one was
 * `httpIdleTimeoutMs`: Pi's own default is 300_000, and it reached the OpenAI SDK as
 * the per-request timeout, so a prefill longer than five minutes failed as
 * `Request timed out.` Measured across the author's sessions, 50 replies failed that
 * way, every one between 300.004s and 308.028s, and not one anywhere near the ceiling
 * Pi Taster had configured. Compaction thresholds and the retry policy were lost with it.
 *
 * Re-applying AFTER the reload rather than before is what makes this hold no matter
 * who reloads.
 */
export class PiTasterResourceLoader extends DefaultResourceLoader {
  /**
   * @param options - Pi's own loader options
   * @param reapplySettings - Puts Pi Taster's overrides back on the settings manager
   */
  constructor(
    options: ConstructorParameters<typeof DefaultResourceLoader>[0],
    private readonly reapplySettings: () => void
  ) {
    super(options)
  }

  /**
   * Reload Pi's resources, then restore the overrides the reload just discarded.
   * @param args - Pi's own reload arguments, passed through untouched
   */
  override async reload(
    ...args: Parameters<DefaultResourceLoader['reload']>
  ): Promise<void> {
    await super.reload(...args)
    this.reapplySettings()
  }
}
