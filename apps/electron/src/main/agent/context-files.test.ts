/**
 * Tests for context-file confinement.
 *
 * The case that motivated it is the first one: sub-apps live under `~/.pitaster/apps/`, so
 * Pi's upward walk reaches `~/.pitaster` and `~` on every single session.
 */

import { describe, expect, test } from 'bun:test'
import { confineContextFiles } from './context-files'

const ROOT = '/Users/someone/.Pi Taster/apps/my-app'

/**
 * Run the filter over a list of paths.
 * @param paths - Absolute paths Pi would have discovered
 * @returns The paths that survive
 */
function keep(paths: string[]): string[] {
  return confineContextFiles(ROOT)({
    agentsFiles: paths.map((path) => ({ path, content: 'x' }))
  }).agentsFiles.map((file) => file.path)
}

describe('confineContextFiles', () => {
  test("keeps the sub-app's own context file", () => {
    expect(keep([`${ROOT}/AGENTS.md`])).toEqual([`${ROOT}/AGENTS.md`])
    expect(keep([`${ROOT}/src/AGENTS.md`])).toEqual([`${ROOT}/src/AGENTS.md`])
  })

  test('drops every ancestor Pi walks through', () => {
    expect(
      keep([
        '/Users/someone/AGENTS.md',
        '/Users/someone/.Pi Taster/AGENTS.md',
        '/Users/someone/.Pi Taster/apps/AGENTS.md',
        '/Users/someone/.Pi Taster/pi/CLAUDE.md'
      ])
    ).toEqual([])
  })

  test('drops a sibling sub-app sharing a name prefix', () => {
    expect(keep([`${ROOT}-other/AGENTS.md`])).toEqual([])
  })

  test('keeps the in-root file when both are present', () => {
    expect(keep(['/Users/someone/.Pi Taster/AGENTS.md', `${ROOT}/AGENTS.md`])).toEqual([
      `${ROOT}/AGENTS.md`
    ])
  })

  test('passes an empty list through', () => {
    expect(keep([])).toEqual([])
  })
})
