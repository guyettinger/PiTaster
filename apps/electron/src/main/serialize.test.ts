/**
 * Tests for the keyed serializer.
 *
 * The property under test is the one the baseline store depends on: a
 * read-modify-write that interleaves loses an entry permanently, because
 * `ensureSessionBaseline` is first-write-wins and never retries.
 */

import { describe, expect, test } from 'bun:test'
import { isBusy, serialized } from './serialize'

/** A read-modify-write with an await between the read and the write. */
function makeStore() {
  const state: Record<string, string> = {}
  return {
    state,
    async put(key: string, value: string): Promise<void> {
      const snapshot = { ...state }
      await new Promise((resolve) => setTimeout(resolve, 5))
      for (const k of Object.keys(state)) delete state[k]
      Object.assign(state, snapshot, { [key]: value })
    }
  }
}

describe('serialized', () => {
  test('an unserialized read-modify-write loses an entry', async () => {
    const store = makeStore()
    await Promise.all([store.put('a', '1'), store.put('b', '2')])
    // Establishes that the hazard is real rather than theoretical: both writes
    // resolved, and one of them is simply not there.
    expect(Object.keys(store.state)).toHaveLength(1)
  })

  test('keeps both writes to one key', async () => {
    const store = makeStore()
    await Promise.all([
      serialized('store', () => store.put('a', '1')),
      serialized('store', () => store.put('b', '2'))
    ])
    expect(store.state).toEqual({ a: '1', b: '2' })
  })

  test('runs in call order', async () => {
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        serialized('order', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5 - n))
          order.push(n)
        })
      )
    )
    expect(order).toEqual([1, 2, 3, 4])
  })

  test('different keys do not wait for each other', async () => {
    let slowDone = false
    const slow = serialized('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      slowDone = true
    })
    await serialized('fast', async () => {})
    expect(slowDone).toBe(false)
    await slow
  })

  test('a rejection reaches its own caller and not the next task', async () => {
    let ran = false
    const failed = serialized('rej', async () => {
      throw new Error('boom')
    })
    const after = serialized('rej', async () => {
      ran = true
      return 'ok'
    })
    expect(failed).rejects.toThrow('boom')
    expect(await after).toBe('ok')
    expect(ran).toBe(true)
  })

  test('forgets a key once its chain drains', async () => {
    await serialized('drain', async () => {})
    // Deletion is scheduled on the settled chain, so it lands a microtask later.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(isBusy('drain')).toBe(false)
  })

  test('returns the task result', async () => {
    expect(await serialized('value', async () => 42)).toBe(42)
  })
})
