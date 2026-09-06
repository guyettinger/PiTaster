import { appAccent, monogram } from '../lib/appAccent'
import type { SubApp } from '@keylimepi/core'

/**
 * The two sizes an app's mark is drawn at.
 *
 * They are named for where they appear rather than for their pixels, because
 * the pair is a relationship: the rail's tile is the smallest one a two-letter
 * monogram stays legible at, and the list's is one step up so the mark balances
 * a card carrying a name and a description. Changing one without the other
 * makes the same app look like two different apps.
 */
const SIZE_CLASS = {
  rail: 'h-9 w-9 text-[12px]',
  list: 'h-10 w-10 text-[13px]'
} as const

/**
 * Props for the AppIcon component.
 */
interface AppIconProps {
  /** The app this mark stands for. */
  app: SubApp
  /** Where it is being drawn. */
  size: keyof typeof SIZE_CLASS
  /** How strongly its hue reads. Defaults to the quieter register. */
  emphasis?: 'resting' | 'full'
}

/**
 * A sub-app's identity mark: its monogram, washed in the hue its id hashes to.
 *
 * One component for both surfaces, which is the whole reason it exists. The nav
 * rail and the Apps list are the two places an app is a *thing you point at*
 * rather than a name in a sentence, and until now they drew unrelated marks —
 * so an app you had learned to find in the rail was something you had to find
 * again by reading in the library.
 *
 * The hue is identity and never state. Nothing here says whether the app is
 * focused, running, or mid-turn: focus is the rail's keylime bar and the card's
 * keylime border, a turn is the rail's dot, and a dev server is the card's. A
 * mark that also carried state would be a mark that changed color for reasons
 * unrelated to which app it is, which is the one thing it must not do.
 *
 * `emphasis` is therefore not a second meaning but the same one at two volumes.
 * The rail rests every tile but the focused one so the focused app is the app
 * you see; the Apps list draws all of them full, because a library is for
 * telling apps apart and there is no focus there to defer to.
 *
 * It is `aria-hidden` at every call site's request — both callers already name
 * the app in text, and a monogram read aloud is two letters of noise.
 */
export function AppIcon({ app, size, emphasis = 'resting' }: AppIconProps) {
  const accent = appAccent(app.id)
  const tone = accent[emphasis]

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-md border font-semibold tracking-tight transition-colors ${SIZE_CLASS[size]} ${tone.bg} ${tone.border} ${tone.text}`}
    >
      {monogram(app.name)}
    </span>
  )
}
