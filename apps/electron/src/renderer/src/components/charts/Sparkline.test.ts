/**
 * Tests for sparkline scaling.
 *
 * The floor is the rule worth pinning: a fast request beside a very slow one rounds to
 * nothing, and a bar that measured something must never look like a bar that measured
 * zero. `StatBar` states the same rule for a diffstat.
 */

import { describe, expect, test } from 'bun:test'
import { scale } from './Sparkline'

describe('scale', () => {
  test('the tallest value fills the bar', () => {
    expect(scale(500, 500)).toBe(1)
  })

  test('a proportional value scales proportionally', () => {
    expect(scale(250, 500)).toBe(0.5)
  })

  test('a tiny value keeps a floor rather than rounding away', () => {
    // 1 in 10000 is 0.0001, which at ten pixels is nothing at all.
    expect(scale(1, 10_000)).toBeGreaterThan(0.1)
  })

  test('a zero draws nothing, because it measured nothing', () => {
    expect(scale(0, 500)).toBe(0)
  })

  test('an all-zero series does not divide by zero', () => {
    expect(scale(0, 0)).toBe(0)
    expect(Number.isFinite(scale(5, 0))).toBe(true)
  })

  test('a negative reading is treated as no measurement', () => {
    expect(scale(-5, 500)).toBe(0)
  })
})
