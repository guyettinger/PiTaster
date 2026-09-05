/**
 * Tests for the title a session carries before anything names it.
 */

import { describe, expect, test } from 'bun:test'
import {
  assertSessionTitle,
  deriveTitle,
  isLegacyPlaceholderName,
  MAX_SESSION_TITLE_CHARS
} from './manager.js'

describe('deriveTitle', () => {
  test('uses the first user message', () => {
    expect(deriveTitle('Fix the sidebar chat list sorting')).toBe(
      'Fix the sidebar chat list sorting'
    )
  })

  test('uses only the first line of a multi-line message', () => {
    expect(deriveTitle('Fix the sorting\n\nHere is what I mean:\n- one')).toBe('Fix the sorting')
  })

  test('truncates a long message', () => {
    expect(deriveTitle('x'.repeat(200))).toBe(`${'x'.repeat(60)}...`)
  })

  test('falls back for an empty message', () => {
    expect(deriveTitle('')).toBe('New Chat')
    expect(deriveTitle('   ')).toBe('New Chat')
  })

  test("falls back for Pi's no-messages placeholder rather than showing it", () => {
    // buildSessionInfo() fills firstMessage with this string, not an empty one.
    expect(deriveTitle('(no messages)')).toBe('New Chat')
  })
})

describe('isLegacyPlaceholderName', () => {
  test('recognises the names the old createSession stamped on every session', () => {
    // These were never chosen by anyone; treating them as real names is what kept
    // an existing install showing a column of identical rows after the fix.
    expect(isLegacyPlaceholderName('New Chat')).toBe(true)
    expect(isLegacyPlaceholderName('Chat')).toBe(true)
  })

  test('leaves a name someone actually typed alone', () => {
    expect(isLegacyPlaceholderName('Chat about pixi')).toBe(false)
    expect(isLegacyPlaceholderName('New Chatter')).toBe(false)
  })
})

describe('assertSessionTitle', () => {
  test('accepts an ordinary title', () => {
    expect(() => assertSessionTitle('Chat about pixi')).not.toThrow()
  })

  test('refuses a non-string, which would throw out of .trim() instead', () => {
    for (const value of [undefined, null, 42, {}, ['a']]) {
      expect(() => assertSessionTitle(value)).toThrow()
    }
  })

  test('refuses a title that is empty or only whitespace', () => {
    expect(() => assertSessionTitle('')).toThrow()
    expect(() => assertSessionTitle('   ')).toThrow()
  })

  test('bounds the length, which is the half `sessions:rename` was missing', () => {
    // The title is appended verbatim into Pi's transcript, so an unbounded one is
    // written to disk and read back by every later listSessions().
    expect(() => assertSessionTitle('x'.repeat(MAX_SESSION_TITLE_CHARS))).not.toThrow()
    expect(() => assertSessionTitle('x'.repeat(MAX_SESSION_TITLE_CHARS + 1))).toThrow()
  })
})
