import type { DockviewTheme } from 'dockview-react'

/**
 * The dock's theme.
 *
 * A `DockviewTheme` is only a name and the class its CSS variables are defined
 * on; the variables themselves live in `styles/globals.css`, mapped onto the
 * shell's existing tokens. Keeping them there rather than in a stylesheet of
 * their own is deliberate — the dock is chrome, and its colors have to move
 * when the palette does.
 */
export const PITASTER_DOCKVIEW_THEME: DockviewTheme = {
  name: 'pitaster',
  className: 'dockview-theme-pitaster'
}
