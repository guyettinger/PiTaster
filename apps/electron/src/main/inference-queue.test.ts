/**
 * Tests for the process-wide turn queue.
 *
 * Three properties matter, and two of them are the ones that would otherwise be
 * discovered as a wedged app: a released ticket always hands the daemon on, and a
 * turn cancelled while queued never runs and never blocks the ones behind it.
 */

import { describe, expect, test } from 'bun:test'
import { InferenceCancelled, InferenceQueue } from './inference-queue'

/** Let queued microtasks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('InferenceQueue', () => {
  test('the first turn does not wait', async () => {
    const queue = new InferenceQueue()
    const ticket = queue.acquire('weather')
    expect(ticket.waitingBehind).toBeNull()
    await ticket.wait()
    expect(queue.activeAppId()).toBe('weather')
  })

  test('a second turn queues and names the app it waits on', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()

    const second = queue.acquire('notes')
    expect(second.waitingBehind).toBe('weather')

    let started = false
    void second.wait().then(() => {
      started = true
    })
    await tick()
    expect(started).toBe(false)

    first.release()
    await tick()
    expect(started).toBe(true)
    expect(queue.activeAppId()).toBe('notes')
  })

  test('turns start in the order they were asked for', async () => {
    const queue = new InferenceQueue()
    const order: string[] = []
    const tickets = ['a', 'b', 'c', 'd'].map((id) => ({ id, ticket: queue.acquire(id) }))

    for (const { id, ticket } of tickets) {
      void ticket.wait().then(() => {
        order.push(id)
        // Released on the next tick so each turn is observably distinct.
        setTimeout(() => ticket.release(), 0)
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(order).toEqual(['a', 'b', 'c', 'd'])
    expect(queue.activeAppId()).toBeNull()
  })

  test('cancelling a queued turn rejects it and lets the next through', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()

    const second = queue.acquire('notes')
    const third = queue.acquire('todo')

    let secondError: unknown = null
    void second.wait().catch((error) => {
      secondError = error
    })
    let thirdStarted = false
    void third.wait().then(() => {
      thirdStarted = true
    })

    expect(queue.cancel('notes')).toBe(true)
    await tick()
    expect(secondError).toBeInstanceOf(InferenceCancelled)
    expect(thirdStarted).toBe(false)

    first.release()
    await tick()
    // The cancelled turn is skipped entirely rather than starting and then
    // failing — the whole point of cancelling before the daemon is touched.
    expect(thirdStarted).toBe(true)
    expect(queue.activeAppId()).toBe('todo')
  })

  test('cancel does not touch the running turn', async () => {
    const queue = new InferenceQueue()
    const ticket = queue.acquire('weather')
    await ticket.wait()
    expect(queue.cancel('weather')).toBe(false)
    expect(queue.activeAppId()).toBe('weather')
  })

  test('releasing a cancelled ticket does not hand the daemon on', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()

    const second = queue.acquire('notes')
    void second.wait().catch(() => {})
    queue.cancel('notes')
    // What the handler's `finally` does after the cancellation surfaced. It must
    // not release a daemon this ticket never held.
    second.release()

    expect(queue.activeAppId()).toBe('weather')
    expect(queue.queueLength()).toBe(0)
  })

  test('releasing a ticket that never started drops it from the queue', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()

    const second = queue.acquire('notes')
    void second.wait().catch(() => {})
    second.release()
    expect(queue.queueLength()).toBe(0)

    first.release()
    await tick()
    expect(queue.activeAppId()).toBeNull()
  })

  test('release is idempotent', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()
    const second = queue.acquire('notes')
    void second.wait()

    first.release()
    await tick()
    expect(queue.activeAppId()).toBe('notes')

    // A second release from the finished turn must not evict the turn that has
    // since started — the failure mode that makes two workspaces generate at once.
    first.release()
    expect(queue.activeAppId()).toBe('notes')
  })

  test('a cancelled turn that is never awaited raises no unhandled rejection', async () => {
    const queue = new InferenceQueue()
    const first = queue.acquire('weather')
    await first.wait()
    queue.acquire('notes')
    queue.cancel('notes')
    // Nothing awaited the ticket. Electron ends the main process on an unhandled
    // rejection under the flags this app runs with, so this is a crash test.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(queue.queueLength()).toBe(0)
  })
})

describe('one app with two turns', () => {
  test('cancelling the queued one does not release the running one', async () => {
    const queue = new InferenceQueue()
    const running = queue.acquire('weather')
    await running.wait()

    // Main does not stop a workspace queueing a second turn, and the composer
    // being disabled in the renderer is not a guarantee main can rely on.
    const second = queue.acquire('weather')
    void second.wait().catch(() => {})
    const other = queue.acquire('notes')
    let otherStarted = false
    void other.wait().then(() => {
      otherStarted = true
    })

    queue.cancel('weather')
    second.release()
    await tick()

    // The daemon is still held by the turn that is genuinely running.
    expect(queue.activeAppId()).toBe('weather')
    expect(otherStarted).toBe(false)

    running.release()
    await tick()
    expect(otherStarted).toBe(true)
  })
})
