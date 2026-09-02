/**
 * Tests for the default workspace layout.
 *
 * dockview resolves each panel's position against the panels already added, so
 * the list is order-dependent in a way the type system cannot see: a
 * `referencePanel` naming a panel that comes later, or a duplicated id, throws
 * inside `addPanel` at runtime — on first launch, with an empty dock and no
 * obvious cause. These are the two mistakes worth catching in a test rather
 * than in the app.
 */

import { describe, expect, test } from 'bun:test'
import { defaultWorkspaceLayout } from './defaultLayout'
import { WORKSPACE_PANEL_NAMES } from './catalog'

describe('defaultWorkspaceLayout', () => {
  test('every panel id is unique', () => {
    const ids = defaultWorkspaceLayout().map((panel) => panel.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every referencePanel names a panel added earlier', () => {
    const seen = new Set<string>()
    for (const panel of defaultWorkspaceLayout()) {
      if (panel.position) {
        expect(seen.has(panel.position.referencePanel)).toBe(true)
      }
      seen.add(panel.id)
    }
  })

  test('only the first panel omits a position', () => {
    const [first, ...rest] = defaultWorkspaceLayout()
    expect(first.position).toBeUndefined()
    for (const panel of rest) {
      expect(panel.position).toBeDefined()
    }
  })

  test('every component is a catalog panel', () => {
    for (const panel of defaultWorkspaceLayout()) {
      expect(WORKSPACE_PANEL_NAMES).toContain(panel.component)
    }
  })

  test('the conversation is present, and no file is opened for you', () => {
    const layout = defaultWorkspaceLayout()
    expect(layout.some((panel) => panel.component === 'chat')).toBe(true)
    expect(layout.some((panel) => panel.component === 'code')).toBe(false)
  })
})
