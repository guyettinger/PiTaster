/**
 * Tests for the recovered tool guidance.
 *
 * The assertions are deliberately about *substance* rather than exact wording: the text
 * is Pi's, read off its live definitions, so pinning the sentences would turn a Pi
 * revision into a failing test. What must hold is that the guidance arrives at all —
 * its absence is the defect this module exists to fix, and it was invisible.
 */

import { describe, expect, test } from 'bun:test'
import { getToolGuidelines, renderToolGuidance } from './tool-guidance'

const ROOT = '/app'

describe('getToolGuidelines', () => {
  test('recovers Pi guidance for the edit tool', () => {
    const guidelines = getToolGuidelines({ rootPath: ROOT, toolNames: ['edit'] })

    expect(guidelines.length).toBeGreaterThan(0)
    // The three facts a model cannot infer from the JSON schema alone.
    expect(guidelines.join('\n')).toContain('edits[]')
    expect(guidelines.some((line) => line.includes('unique'))).toBe(true)
    expect(guidelines.some((line) => line.includes('original file'))).toBe(true)
  })

  test('returns nothing for a tool the session did not enable', () => {
    const guidelines = getToolGuidelines({ rootPath: ROOT, toolNames: ['edit'] })
    const withWrite = getToolGuidelines({ rootPath: ROOT, toolNames: ['edit', 'write'] })

    expect(withWrite.length).toBeGreaterThan(guidelines.length)
  })

  test('ignores names that are not Pi built-ins', () => {
    expect(getToolGuidelines({ rootPath: ROOT, toolNames: ['replace_lines', 'git_status'] })).toEqual([])
    expect(getToolGuidelines({ rootPath: ROOT, toolNames: [] })).toEqual([])
  })

  test('emits each guideline once, however many tools contribute it', () => {
    const all = getToolGuidelines({
      rootPath: ROOT,
      toolNames: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']
    })
    expect(new Set(all).size).toBe(all.length)
  })

  test('is stable across calls, so the prompt prefix does not churn', () => {
    const once = getToolGuidelines({ rootPath: ROOT, toolNames: ['ls', 'edit', 'read'] })
    const twice = getToolGuidelines({ rootPath: ROOT, toolNames: ['read', 'edit', 'ls'] })
    expect(once).toEqual(twice)
  })
})

describe('renderToolGuidance', () => {
  test('renders a heading and bullets', () => {
    const section = renderToolGuidance({ rootPath: ROOT, toolNames: ['edit'] })
    expect(section).toContain('## Tool Use')
    expect(section).toContain('\n- ')
  })

  test('renders nothing rather than an empty heading', () => {
    expect(renderToolGuidance({ rootPath: ROOT, toolNames: [] })).toBe('')
  })
})
