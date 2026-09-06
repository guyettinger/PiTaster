/**
 * Tests for a sub-app's identity mark — its monogram and its tile color.
 *
 * Three things have to hold, and only the first is obvious:
 *
 *   - A monogram never comes back empty. It is the *only* thing that tells two
 *     apps apart when they collide on a hue, so a name of punctuation or
 *     whitespace has to degrade to something drawable rather than to ''.
 *   - An accent is a pure function of the app id. Nothing persists it, so a tile
 *     that changed color between the rail and the Apps list — or between two
 *     launches — would have no way to be corrected.
 *   - The class strings stay literal. Tailwind's scanner reads source text, so a
 *     ramp assembled by interpolation compiles to no CSS at all and every tile
 *     renders transparent. That failure is invisible to typecheck.
 */

import { describe, expect, test } from 'bun:test'
import { APP_ACCENTS, appAccent, monogram } from './appAccent'

describe('monogram', () => {
  test('takes the initials of the first two words', () => {
    expect(monogram('Todo Dash')).toBe('TD')
    expect(monogram('my great app')).toBe('MG')
  })

  test('takes two letters from a single word', () => {
    expect(monogram('Notes')).toBe('NO')
    expect(monogram('a')).toBe('A')
  })

  test('splits on hyphens and underscores as well as spaces', () => {
    expect(monogram('todo-dash')).toBe('TD')
    expect(monogram('todo_dash')).toBe('TD')
    expect(monogram('  todo   dash  ')).toBe('TD')
  })

  /*
   * `generateId` strips a name to [a-z0-9-], so '!!!' is a name a user can
   * really create. The tile still has to draw something.
   */
  test('never returns an empty string', () => {
    for (const name of ['', '   ', '!!!', '...', '-', '_ -']) {
      expect(monogram(name).length).toBeGreaterThan(0)
    }
  })

  test('handles a name that is only punctuation', () => {
    expect(monogram('!!!')).toBe('!!')
  })
})

describe('appAccent', () => {
  test('is stable for a given id', () => {
    expect(appAccent('todo-dash')).toBe(appAccent('todo-dash'))
  })

  test('always returns a member of the ramp', () => {
    for (const id of ['a', 'todo-dash', '', 'x'.repeat(200), '9']) {
      expect(APP_ACCENTS).toContain(appAccent(id))
    }
  })

  test('spreads realistic ids across the whole ramp', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `app-${i}`)
    const used = new Set(ids.map((id) => appAccent(id).name))
    expect(used.size).toBe(APP_ACCENTS.length)
  })

  test('does not map similar ids to one hue', () => {
    const used = new Set(['app-1', 'app-2', 'app-3', 'app-4'].map((id) => appAccent(id).name))
    expect(used.size).toBeGreaterThan(1)
  })
})

describe('APP_ACCENTS', () => {
  test('has eight distinct hues', () => {
    expect(APP_ACCENTS).toHaveLength(8)
    expect(new Set(APP_ACCENTS.map((a) => a.name)).size).toBe(8)
  })

  /*
   * The scanner check, and it has to read the source rather than the export.
   *
   * Tailwind compiles the class names it can find in the *source text*. The
   * first version of this ramp built its classes from a helper, so the file
   * Tailwind scanned contained only `bg-app-${…}` and the eight hues compiled to
   * zero CSS rules — every tile transparent, with the types checking, the build
   * succeeding, and this very assertion passing when it was written against
   * `APP_ACCENTS` values, because interpolation is resolved long before a test
   * can see it. Asserting on the export cannot catch the bug the export is
   * downstream of.
   */
  test('spells every class out literally in the source', async () => {
    const source = await Bun.file(new URL('./appAccent.ts', import.meta.url)).text()
    const table = source.slice(source.indexOf('export const APP_ACCENTS'))

    for (const accent of APP_ACCENTS) {
      const classes = [...Object.values(accent.resting), ...Object.values(accent.full)]
      for (const cls of classes) {
        expect(table).toContain(`'${cls}'`)
      }
    }
  })

  test('builds no class name by interpolation', () => {
    for (const accent of APP_ACCENTS) {
      for (const cls of [...Object.values(accent.resting), ...Object.values(accent.full)]) {
        expect(cls).toContain(`app-${accent.name}`)
      }
    }
  })
})
