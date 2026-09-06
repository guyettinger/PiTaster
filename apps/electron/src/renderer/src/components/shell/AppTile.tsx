import { AppIcon } from '../AppIcon'
import type { SubApp } from '@keylimepi/core'

/**
 * Props for the AppTile component.
 */
interface AppTileProps {
  /** The open app this tile stands for. */
  app: SubApp
  /** Whether this app's workspace is the one on screen. */
  focused: boolean
  /** Whether this app's agent is mid-turn. */
  busy: boolean
  /** Focus this app's workspace. */
  onFocus: () => void
  /** Close this app's tile. */
  onClose: () => void
}

/**
 * One open sub-app in the nav rail.
 *
 * This is what replaced the rail's Workspace destination. There is no longer a
 * place called "the workspace" to navigate to — the app *is* the destination,
 * which is what let the rail narrow: the label that set its width was the word
 * "Workspace", not any of the ones that remain.
 *
 * The name is a tooltip rather than a caption for the same reason. Captioning it
 * would put an arbitrary-length string back under the tile and reintroduce
 * exactly the clipping the rail just escaped, this time with no upper bound —
 * app names are the user's to choose.
 *
 * The mark itself is `AppIcon`, shared with the Apps list so an app learned in
 * one is recognised in the other. Giving each tile its own hue cost the tile its
 * old focus treatment: focus used to be `bg-keylime/10` on the tile, which a
 * tile that already carries a color cannot also carry. So the keylime bar at the
 * left is now the only saturated mark on the rail, and it means what keylime
 * means everywhere else — this is the one you are in. The hue underneath it says
 * only which app it is.
 */
export function AppTile({ app, focused, busy, onFocus, onClose }: AppTileProps) {
  return (
    <div className="group relative">
      <button
        onClick={onFocus}
        aria-current={focused ? 'page' : undefined}
        title={app.name}
        className={`relative flex w-full items-center justify-center rounded-md py-2 transition-colors ${
          focused ? 'text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-keylime transition-opacity ${
            focused ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <AppIcon app={app} size="rail" emphasis={focused ? 'full' : 'resting'} />
        <span className="sr-only">{app.name}</span>
      </button>

      {/*
        The turn indicator. Its slot is always rendered so the tile does not
        change size when a turn starts — a rail that reflows while the agent
        works is a rail whose tiles move under the pointer.

        It sits bottom-right rather than top-right because the close button's
        disc now occupies that corner. As a bare glyph the close could overlap
        the dot harmlessly; as an opaque circle it would cover it outright, and
        hovering a tile to close it is exactly when you want to see that its
        agent is still working.
      */}
      <span
        aria-hidden={!busy}
        className={`pointer-events-none absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-keylime ring-2 ring-panel transition-opacity ${
          busy ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {busy && <span className="sr-only">{app.name} is working</span>}

      {/*
        Raised above the tile button, the way `AppCard` raises its run and delete
        controls, so the stretched target underneath keeps every other click.

        The disc is what makes it legible. A bare glyph over a plain `raised`
        tile was readable; over eight different hues it is not, so the control
        brings its own ground rather than depending on what it lands on.

        `top-0` rather than a symmetrical `-top-1`, because the offsets are not
        symmetrical: the 36px mark is centred in a full-width button, so the
        vertical distance to its corner is the button's `py-2` and the horizontal
        one is half the leftover width. A matching negative offset on both put
        the disc 3px above the corner and, at a 2px rail gap, 2px onto the tile
        above — which read as a badge floating between two tiles rather than
        belonging to either.
      */}
      <button
        onClick={onClose}
        aria-label={`Close ${app.name}`}
        title={`Close ${app.name}`}
        className="absolute -right-1 top-0 z-10 hidden rounded-full bg-ground/80 p-1 text-ash ring-1 ring-line backdrop-blur-[2px] transition-colors hover:bg-ground hover:text-bone group-hover:block focus-visible:block"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  )
}
