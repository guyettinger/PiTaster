/**
 * Tests for sampling resolution.
 *
 * The failure this guards against is the one that shipped: a value that looks set,
 * is sent on every request, and is wrong for the model receiving it. Nothing about
 * greedy decoding on a reasoning model announces itself — it shows up as the model
 * looping, which `agent/loop-guard.ts` then catches and reports as the model's fault.
 */

import { describe, expect, test } from 'bun:test'
import { RECOMMENDED_SAMPLING } from '@keylimepi/core'
import { describeAutoSampling, hasSampling, resolveSampling } from './sampling'

describe('resolveSampling', () => {
  test('gives a reasoning model the values it is documented to want', () => {
    expect(
      resolveSampling({ temperature: 'auto', topP: 'auto', supportsThinking: true })
    ).toEqual({
      temperature: RECOMMENDED_SAMPLING.thinking.temperature,
      topP: RECOMMENDED_SAMPLING.thinking.topP
    })
  })

  test('keeps a non-reasoning model greedy, and sends no top_p', () => {
    // A nucleus cutoff is meaningless at temperature 0, and a parameter sent for no
    // reason is one more thing that can be wrong.
    expect(
      resolveSampling({ temperature: 'auto', topP: 'auto', supportsThinking: false })
    ).toEqual({ temperature: RECOMMENDED_SAMPLING.plain.temperature })
  })

  test('a pinned value wins over the recommendation', () => {
    expect(resolveSampling({ temperature: 1.2, topP: 0.5, supportsThinking: true })).toEqual({
      temperature: 1.2,
      topP: 0.5
    })
  })

  test('pinned zero is sent, and is not confused with sending nothing', () => {
    // `temperature: 0` is greedy decoding; an absent `temperature` is whatever the
    // Modelfile says. Collapsing the two would silently hand the model back to Ollama's
    // 0.7-or-higher default.
    expect(
      resolveSampling({ temperature: 0, topP: null, supportsThinking: true })
    ).toEqual({ temperature: 0 })
  })

  test('null sends nothing at all', () => {
    expect(
      resolveSampling({ temperature: null, topP: null, supportsThinking: true })
    ).toEqual({})
  })

  test('the two settings resolve independently', () => {
    expect(
      resolveSampling({ temperature: null, topP: 'auto', supportsThinking: true })
    ).toEqual({ topP: RECOMMENDED_SAMPLING.thinking.topP })
  })

  test('recommends no top_p beside a pinned greedy temperature', () => {
    // The combination an install carrying Key Lime Pi's old pinned 0 would otherwise get the
    // moment this field appeared: a nucleus cutoff modifying a temperature that leaves
    // it nothing to do.
    expect(
      resolveSampling({ temperature: 0, topP: 'auto', supportsThinking: true })
    ).toEqual({ temperature: 0 })
  })

  test('still honours a pinned top_p beside a greedy temperature', () => {
    // Suppression is a property of the *recommendation*, not a rule imposed on the
    // user: a value they typed is sent.
    expect(
      resolveSampling({ temperature: 0, topP: 0.9, supportsThinking: true })
    ).toEqual({ temperature: 0, topP: 0.9 })
  })
})

describe('hasSampling', () => {
  test('is false when nothing resolved', () => {
    expect(hasSampling({})).toBe(false)
  })

  test('is true for a pinned zero', () => {
    // The obvious falsy-check bug: 0 is a value Key Lime Pi deliberately sends.
    expect(hasSampling({ temperature: 0 })).toBe(true)
  })

  test('is true for top_p alone', () => {
    expect(hasSampling({ topP: 0.95 })).toBe(true)
  })
})

describe('describeAutoSampling', () => {
  test('names the numbers actually in effect', () => {
    expect(describeAutoSampling(true)).toContain(
      String(RECOMMENDED_SAMPLING.thinking.temperature)
    )
    expect(describeAutoSampling(true)).toContain(String(RECOMMENDED_SAMPLING.thinking.topP))
    expect(describeAutoSampling(false)).toContain('no top_p')
  })
})
