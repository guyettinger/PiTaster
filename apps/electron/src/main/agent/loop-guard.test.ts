/**
 * Tests for the loop guard.
 */

import { describe, expect, test } from 'bun:test'
import { createLoopGuard } from './loop-guard'

describe('createLoopGuard', () => {
  test('allows a call the first two times', () => {
    const guard = createLoopGuard()
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
  })

  test('blocks the third identical call and says why', () => {
    const guard = createLoopGuard()
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/x' })

    const verdict = guard.check('read', { path: '/x' })
    expect(verdict.blocked).toBe(true)
    expect(verdict.reason).toContain('read')
    expect(verdict.reason).toContain('different approach')
  })

  test('gives the model a clean attempt after blocking', () => {
    const guard = createLoopGuard()
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/x' })
    expect(guard.check('read', { path: '/x' }).blocked).toBe(true)
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
  })

  test('a different argument breaks the streak', () => {
    const guard = createLoopGuard()
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/y' })
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
  })

  test('a different tool breaks the streak', () => {
    const guard = createLoopGuard()
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/x' })
    guard.check('ls', { path: '/x' })
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
  })

  test('reset forgets the streak', () => {
    const guard = createLoopGuard()
    guard.check('read', { path: '/x' })
    guard.check('read', { path: '/x' })
    guard.reset()
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
  })

  test('never blocks unserialisable arguments', () => {
    const guard = createLoopGuard()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    for (let i = 0; i < 5; i += 1) {
      expect(guard.check('bash', circular).blocked).toBe(false)
    }
  })
})

describe('loop guard streak lifetime', () => {
  test('survives across model rounds within one prompt', () => {
    // The guard is reset on `agent_start` (once per user prompt), never on
    // `turn_start` (once per assistant round). A model stuck re-issuing the same
    // call does so across rounds, so a per-round reset would make the guard inert.
    const guard = createLoopGuard()

    // Three rounds of the same call, with no reset between them.
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
    expect(guard.check('read', { path: '/x' }).blocked).toBe(false)
    expect(guard.check('read', { path: '/x' }).blocked).toBe(true)
  })
})
