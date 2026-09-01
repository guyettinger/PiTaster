/**
 * Tests for the title a session carries before anything names it.
 */

import { describe, expect, test } from 'bun:test'
import { deriveTitle, isLegacyPlaceholderName } from './manager.js'

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
