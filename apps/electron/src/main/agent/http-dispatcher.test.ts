/**
 * Tests for the global undici dispatcher.
 *
 * The property worth protecting is that the teardown `error` listener reaches the
 * pooled clients and not just the agent that owns them. undici raises that event on
 * the `Client`, so a listener attached only to the agent never sees it — and an
 * unhandled `error` on an `EventEmitter` ends the main process. Tripping the idle
 * timeout is a normal outcome here, so that is a crash on an ordinary path.
 */

import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import * as undici from 'undici'
import {
  configureHttpDispatcher,
  createClient,
  createOriginDispatcher,
  HTTP_IDLE_TIMEOUT_MS,
  NODE_DEFAULT_IDLE_TIMEOUT_MS
} from './http-dispatcher'

describe('configureHttpDispatcher', () => {
  test('installs once and reports whether it did', () => {
    // The module guards itself so a dispatcher is never swapped out from under an
    // in-flight request. Whichever call wins, later ones must be no-ops.
    const first = configureHttpDispatcher()
    const second = configureHttpDispatcher()

    expect(typeof first).toBe('boolean')
    expect(second).toBe(false)
  })

  test('leaves a global dispatcher in place', () => {
    configureHttpDispatcher()
    expect(undici.getGlobalDispatcher()).toBeDefined()
  })

  test('raises the ceiling it exists to replace', () => {
    // Ollama sends no headers until the first token, so undici's 300s default kills
    // any prefill past five minutes — which a large local model passes routinely.
    expect(HTTP_IDLE_TIMEOUT_MS).toBeGreaterThan(NODE_DEFAULT_IDLE_TIMEOUT_MS)
  })
})

describe('createClient', () => {
  test('attaches an error listener to the client itself', () => {
    const client = createClient('http://127.0.0.1:1', {})
    expect(EventEmitter.prototype.listenerCount.call(client, 'error')).toBeGreaterThan(0)
  })

  test('swallows the teardown error rather than rethrowing it', () => {
    const client = createClient('http://127.0.0.1:1', {})

    expect(() => {
      EventEmitter.prototype.emit.call(client, 'error', new Error('socket hang up'))
    }).not.toThrow()
  })
})

describe('createOriginDispatcher', () => {
  test('attaches the listener to a single-connection client', () => {
    const dispatcher = createOriginDispatcher('http://127.0.0.1:1', { connections: 1 })
    expect(EventEmitter.prototype.listenerCount.call(dispatcher, 'error')).toBeGreaterThan(0)
  })

  test('attaches the listener to a pool and to the clients it makes', () => {
    const pool = createOriginDispatcher('http://127.0.0.1:1', { connections: 4 })
    expect(EventEmitter.prototype.listenerCount.call(pool, 'error')).toBeGreaterThan(0)

    expect(() => {
      EventEmitter.prototype.emit.call(pool, 'error', new Error('other side closed'))
    }).not.toThrow()
  })

  test('an emitter with no listener does throw', () => {
    // Confirms the tests above test something: this is what the pooled clients did
    // before `clientFactory`/`factory` were passed to the agent.
    const bare = new EventEmitter()

    expect(() => {
      bare.emit('error', new Error('socket hang up'))
    }).toThrow('socket hang up')
  })
})
