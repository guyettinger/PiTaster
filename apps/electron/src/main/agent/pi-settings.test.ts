/**
 * Tests that Pi Taster's Pi settings actually reach the session.
 *
 * Nothing asserted this, and that is exactly how the bug shipped: `buildPiSettings`
 * was correct, `applyOverrides` was called, and every value was discarded before the
 * first request. `SettingsManager.applyOverrides` is not durable — `reload()`
 * recomputes `settings` from the global and project files alone — and both the
 * resource loader and `createAgentSession` reload.
 *
 * The visible cost was `httpIdleTimeoutMs`. Pi's own default is 300_000 and it
 * reaches the OpenAI SDK as that request's timeout, so a prefill over five minutes
 * failed as `Request timed out.` Measured across the author's sessions: 50 replies
 * failed that way, every one between 300.004s and 308.028s, and none anywhere near
 * the ceiling Pi Taster had configured.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { deriveContextBudget } from './context-budget'
import { HTTP_IDLE_TIMEOUT_MS } from './http-dispatcher'
import { PiTasterResourceLoader, buildPiSettings } from './pi-settings'

let root: string
let appDir: string
let agentDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pitaster-pi-settings-'))
  appDir = join(root, 'app')
  agentDir = join(root, 'agent')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Build a settings manager carrying Pi Taster's overrides.
 * @returns The manager, the budget it was built from, and the re-apply function
 */
function withOverrides(): {
  settingsManager: SettingsManager
  budget: ReturnType<typeof deriveContextBudget>
  applyPiTasterSettings: () => void
} {
  const budget = deriveContextBudget()
  const settingsManager = SettingsManager.create(appDir, agentDir)
  const applyPiTasterSettings = (): void => {
    settingsManager.applyOverrides(buildPiSettings(budget))
  }
  applyPiTasterSettings()
  return { settingsManager, budget, applyPiTasterSettings }
}

describe('Pi Taster settings reaching Pi', () => {
  test('a plain reload discards them, which is why the loader exists', async () => {
    // Pinning Pi's behaviour, not endorsing it. If a future Pi makes `applyOverrides`
    // durable this fails, and the failure is the notice that `PiTasterResourceLoader`
    // has become unnecessary.
    const { settingsManager, applyPiTasterSettings } = withOverrides()
    expect(settingsManager.getHttpIdleTimeoutMs()).toBe(HTTP_IDLE_TIMEOUT_MS)

    await settingsManager.reload()

    expect(settingsManager.getHttpIdleTimeoutMs()).not.toBe(HTTP_IDLE_TIMEOUT_MS)
    applyPiTasterSettings()
    expect(settingsManager.getHttpIdleTimeoutMs()).toBe(HTTP_IDLE_TIMEOUT_MS)
  })

  test('PiTasterResourceLoader keeps the prefill ceiling across a reload', async () => {
    const { settingsManager, applyPiTasterSettings } = withOverrides()
    const loader = new PiTasterResourceLoader(
      { cwd: appDir, agentDir, settingsManager },
      applyPiTasterSettings
    )

    await loader.reload()

    // The whole bug in one assertion: this read 300_000 before the loader existed.
    expect(settingsManager.getHttpIdleTimeoutMs()).toBe(HTTP_IDLE_TIMEOUT_MS)
  })

  test('it keeps them across repeated reloads, not just the first', async () => {
    // `createAgentHost` reloads once today, but `reload` itself can reload settings
    // more than once internally, and the repair has to be a property of the loader
    // rather than of that one call site.
    const { settingsManager, applyPiTasterSettings } = withOverrides()
    const loader = new PiTasterResourceLoader(
      { cwd: appDir, agentDir, settingsManager },
      applyPiTasterSettings
    )

    await loader.reload()
    await loader.reload()
    await loader.reload()

    expect(settingsManager.getHttpIdleTimeoutMs()).toBe(HTTP_IDLE_TIMEOUT_MS)
  })

  test('the retry policy survives too, including the disabled provider retries', async () => {
    // Provider-level retries are invisible: they happen underneath Pi's own policy,
    // so a recoverable failure becomes a longer unexplained wait with no event.
    const { settingsManager, applyPiTasterSettings } = withOverrides()
    const loader = new PiTasterResourceLoader(
      { cwd: appDir, agentDir, settingsManager },
      applyPiTasterSettings
    )

    await loader.reload()

    expect(settingsManager.getRetrySettings().maxRetries).toBe(4)
    expect(settingsManager.getRetrySettings().enabled).toBe(true)
    expect(settingsManager.getProviderRetrySettings().maxRetries).toBe(0)
  })

  test('the compaction thresholds survive, and they are the budget-derived ones', async () => {
    // Pi's defaults reserve 16384 and retain 20000 — 36k, more than half the window
    // Pi Taster's models serve, which makes a session compact far more often than it
    // should. Every compaction then forces the slow re-prefill this all turns on.
    const { settingsManager, budget, applyPiTasterSettings } = withOverrides()
    const loader = new PiTasterResourceLoader(
      { cwd: appDir, agentDir, settingsManager },
      applyPiTasterSettings
    )

    await loader.reload()

    expect(settingsManager.getCompactionSettings()).toMatchObject(budget.compaction)
  })

  test('buildPiSettings carries the module constant, so the two cannot drift', () => {
    expect(buildPiSettings(deriveContextBudget()).httpIdleTimeoutMs).toBe(HTTP_IDLE_TIMEOUT_MS)
  })
})
