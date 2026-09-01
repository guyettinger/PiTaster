/**
 * Tests for generated session titles.
 *
 * The validation is the whole safety story here: a bad title is written to the
 * transcript and there is no way to recognise it as wrong afterwards, so anything
 * that is not obviously a title has to be rejected before it lands.
 */

import { describe, expect, test } from 'bun:test'
import { normalizeGeneratedTitle, summarizeSessionTitle } from './session-title'

describe('normalizeGeneratedTitle', () => {
  test('accepts a plain short title', () => {
    expect(normalizeGeneratedTitle('Fix the sidebar sorting')).toBe('Fix the sidebar sorting')
  })

  test('strips surrounding quotes, straight and smart', () => {
    expect(normalizeGeneratedTitle('"Dark mode toggle"')).toBe('Dark mode toggle')
    expect(normalizeGeneratedTitle('“Dark mode toggle”')).toBe('Dark mode toggle')
    expect(normalizeGeneratedTitle('`Dark mode toggle`')).toBe('Dark mode toggle')
  })

  test('strips a label the model added', () => {
    expect(normalizeGeneratedTitle('Title: Preview panel debugging')).toBe(
      'Preview panel debugging'
    )
  })

  test('strips terminal punctuation', () => {
    expect(normalizeGeneratedTitle('Preview panel debugging.')).toBe('Preview panel debugging')
  })

  test('collapses internal whitespace', () => {
    expect(normalizeGeneratedTitle('Fix   the\tsidebar')).toBe('Fix the sidebar')
  })

  test('keeps only the first line, dropping commentary after it', () => {
    expect(normalizeGeneratedTitle('Sidebar sort fix\n\nThis title summarizes...')).toBe(
      'Sidebar sort fix'
    )
  })

  test('rejects an empty or whitespace-only response', () => {
    expect(normalizeGeneratedTitle('')).toBeNull()
    expect(normalizeGeneratedTitle('   \n  ')).toBeNull()
  })

  test('rejects a title that is too long in characters', () => {
    expect(normalizeGeneratedTitle('x'.repeat(61))).toBeNull()
  })

  test('rejects a title that is too long in words', () => {
    expect(normalizeGeneratedTitle('a b c d e f g h i')).toBeNull()
  })

  test('rejects a response with no letters or digits', () => {
    expect(normalizeGeneratedTitle('--- ***')).toBeNull()
  })

  test('rejects a refusal, which is a sentence rather than a title', () => {
    expect(
      normalizeGeneratedTitle("I'm sorry, but I can't help with summarizing that request.")
    ).toBeNull()
  })

  test('drops a closed reasoning block and titles from what follows', () => {
    expect(normalizeGeneratedTitle('<think>The user wants a title.</think>\nSidebar sort fix')).toBe(
      'Sidebar sort fix'
    )
  })

  test('rejects an unterminated reasoning block, which ran out of budget', () => {
    expect(normalizeGeneratedTitle('<think>The user wants a title about the')).toBeNull()
  })
})

describe('summarizeSessionTitle', () => {
  test('returns null when the daemon is not there, rather than throwing', async () => {
    // The whole failure story: a title that cannot be generated leaves the derived
    // one in place, and nothing upstream has to handle an error to get that.
    const title = await summarizeSessionTitle({
      // Port 1 is reserved and never listening.
      baseUrl: 'http://127.0.0.1:1',
      modelId: 'whatever',
      firstMessage: 'Fix the sidebar sorting'
    })
    expect(title).toBeNull()
  })

  test('returns null for an empty first message without calling out', async () => {
    const title = await summarizeSessionTitle({
      baseUrl: 'http://127.0.0.1:1',
      modelId: 'whatever',
      firstMessage: '   '
    })
    expect(title).toBeNull()
  })
})
