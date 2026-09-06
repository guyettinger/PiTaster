/**
 * A sub-app's identity mark: the monogram drawn on its tile, and the hue the
 * tile is washed in.
 *
 * Both surfaces that stand for an app — the nav rail's `AppTile` and the Apps
 * list's `AppCard` — read from here, which is the point. They used to draw
 * unrelated things: the rail a name monogram, the list a template emoji. The
 * emoji was the weaker of the two for the reason `appTemplates.ts` still gives —
 * every app made from one template carries the same glyph, so a library of three
 * React apps was three identical icons — so the monogram travelled to the list
 * rather than the glyph to the rail.
 */

/**
 * One entry in the app identity ramp.
 *
 * The class strings are spelled out rather than assembled because Tailwind
 * compiles what it can read in the source: a class built as `bg-app-${name}/10`
 * produces no CSS, and the tile renders transparent with nothing failing. This
 * is the same reason `AppShellHeader`'s `HAIRLINE_CLASS` is a literal map, and
 * `appAccent.test.ts` asserts it stays one.
 */
export interface AppAccent {
  /** The hue's name. An identifier for the ramp slot, not a meaning. */
  name: string
  /** The quieter register: an unfocused tile in the nav rail. */
  resting: { bg: string; border: string; text: string }
  /** The full register: a focused rail tile, and every tile in the Apps list. */
  full: { bg: string; border: string; text: string }
}

/**
 * The eight hues a sub-app can be assigned, defined in `globals.css`.
 *
 * Written out in full, and it has to stay that way. Tailwind compiles the class
 * names it can *read in the source text*, so the obvious version of this table —
 * a loop, or a helper returning a template literal — emits no CSS whatsoever and
 * every tile renders transparent. Nothing fails on the way there: the strings are
 * well-formed, the types check, the build succeeds, and even a runtime assertion
 * that no value contains an unresolved interpolation passes, because by then the
 * interpolation is long since resolved. This file was written with the helper
 * first, and the ramp compiled to zero rules.
 *
 * `appAccent.test.ts` therefore greps this file's own source rather than the
 * array it exports — that is the only check looking at what Tailwind looks at.
 *
 * Ordered around the color wheel, which matters only in that adjacent entries
 * are adjacent hues — the hash below does not walk this array in order, so two
 * apps created back to back do not land on two neighbouring hues.
 *
 * The alphas keep the ramp from spending the palette's saturation budget: over
 * `raised`, 10% is a tint you notice only beside another one, and 20% is a tile
 * you can pick out of a rail of eight.
 */
export const APP_ACCENTS: readonly AppAccent[] = [
  {
    name: 'rose',
    resting: { bg: 'bg-app-rose/10', border: 'border-app-rose/25', text: 'text-app-rose/70' },
    full: { bg: 'bg-app-rose/20', border: 'border-app-rose/50', text: 'text-app-rose' }
  },
  {
    name: 'amber',
    resting: { bg: 'bg-app-amber/10', border: 'border-app-amber/25', text: 'text-app-amber/70' },
    full: { bg: 'bg-app-amber/20', border: 'border-app-amber/50', text: 'text-app-amber' }
  },
  {
    name: 'olive',
    resting: { bg: 'bg-app-olive/10', border: 'border-app-olive/25', text: 'text-app-olive/70' },
    full: { bg: 'bg-app-olive/20', border: 'border-app-olive/50', text: 'text-app-olive' }
  },
  {
    name: 'jade',
    resting: { bg: 'bg-app-jade/10', border: 'border-app-jade/25', text: 'text-app-jade/70' },
    full: { bg: 'bg-app-jade/20', border: 'border-app-jade/50', text: 'text-app-jade' }
  },
  {
    name: 'cyan',
    resting: { bg: 'bg-app-cyan/10', border: 'border-app-cyan/25', text: 'text-app-cyan/70' },
    full: { bg: 'bg-app-cyan/20', border: 'border-app-cyan/50', text: 'text-app-cyan' }
  },
  {
    name: 'blue',
    resting: { bg: 'bg-app-blue/10', border: 'border-app-blue/25', text: 'text-app-blue/70' },
    full: { bg: 'bg-app-blue/20', border: 'border-app-blue/50', text: 'text-app-blue' }
  },
  {
    name: 'indigo',
    resting: { bg: 'bg-app-indigo/10', border: 'border-app-indigo/25', text: 'text-app-indigo/70' },
    full: { bg: 'bg-app-indigo/20', border: 'border-app-indigo/50', text: 'text-app-indigo' }
  },
  {
    name: 'magenta',
    resting: { bg: 'bg-app-magenta/10', border: 'border-app-magenta/25', text: 'text-app-magenta/70' },
    full: { bg: 'bg-app-magenta/20', border: 'border-app-magenta/50', text: 'text-app-magenta' }
  }
]

/**
 * The hue for an app, from its id.
 *
 * FNV-1a, because the property that matters is avalanche rather than
 * cryptographic strength: app ids are slugs, so they arrive in runs like
 * `notes`, `notes-2`, `notes-3`, and a hash that maps a one-character
 * difference to an adjacent bucket would give a user's related apps one color.
 *
 * Nothing persists the result. That is what keeps the rail and the Apps list in
 * agreement without a store to disagree with, and what keeps a tile color out of
 * `.keylimepi-meta.json`, where — being tracked and auto-committed — it would be
 * rolled back along with the code.
 *
 * @param appId - The app's id
 * @returns One of the eight ramp entries
 */
export function appAccent(appId: string): AppAccent {
  let hash = 0x811c9dc5
  for (let i = 0; i < appId.length; i++) {
    hash ^= appId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return APP_ACCENTS[(hash >>> 0) % APP_ACCENTS.length]
}

/**
 * A short monogram for an app, from its name.
 *
 * The name rather than the template glyph, and the difference is not cosmetic:
 * every app made from the same template carries the same glyph, so a rail of
 * three React apps was three identical tiles distinguishable only by position.
 * A monogram is derived from the one thing that is actually per-app.
 *
 * It is also what makes a hue collision a non-event. Eight hues cannot keep
 * every library distinct, so the color is the coarse sort and this is the fine
 * one — which is why it must never come back empty. `generateId` strips a name
 * to `[a-z0-9-]`, so a name of `!!!` is one a user can really create, and the
 * fallback takes its first characters rather than substituting a `?`: on a rail
 * of two such apps a shared `?` would tell them apart no better than the hue.
 *
 * @param name - The app's name
 * @returns One or two characters, upper-cased
 */
export function monogram(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return name.trim().slice(0, 2) || '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
