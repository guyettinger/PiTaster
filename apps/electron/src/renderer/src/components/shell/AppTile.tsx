import type { SubApp } from '@pitaster/core'

/**
 * A short monogram for an app, from its name.
 *
 * The name rather than the template glyph, and the difference is not cosmetic:
 * every app made from the same template carries the same glyph, so a rail of
 * three React apps was three identical tiles distinguishable only by position.
 * A monogram is derived from the one thing that is actually per-app.
 *
 * @param name - The app's name
 * @returns One or two characters, upper-cased
 */
function monogram(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

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
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 items-center justify-center rounded-md border text-[12px] font-semibold tracking-tight transition-colors ${
            focused
              ? 'border-keylime/50 bg-keylime/10 text-keylime'
              : 'border-line bg-raised text-ash'
          }`}
        >
          {monogram(app.name)}
        </span>
        <span className="sr-only">{app.name}</span>
      </button>

      {/*
        The turn indicator. Its slot is always rendered so the tile does not
        change size when a turn starts — a rail that reflows while the agent
        works is a rail whose tiles move under the pointer.
      */}
      <span
        aria-hidden={!busy}
        className={`pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-keylime transition-opacity ${
          busy ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {busy && <span className="sr-only">{app.name} is working</span>}

      {/*
        Raised above the tile button, the way `AppCard` raises its run and delete
        controls, so the stretched target underneath keeps every other click.
      */}
      <button
        onClick={onClose}
        aria-label={`Close ${app.name}`}
        title={`Close ${app.name}`}
        className="absolute -right-0.5 -top-0.5 z-10 hidden rounded p-1 text-ash transition-colors hover:bg-raised hover:text-bone group-hover:block focus-visible:block"
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
