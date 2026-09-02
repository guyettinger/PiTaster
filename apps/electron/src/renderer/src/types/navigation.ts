/**
 * Shell navigation state.
 *
 * The shell distinguishes two kinds of nav, because they behave differently and
 * the old rail's habit of drawing them identically is what made it unreadable:
 *
 * - A **main panel** is a destination. Picking one replaces the view.
 * - A **docked panel** is an inspector on the workspace. Toggling one adds to
 *   the view without leaving it.
 */

/** A destination in the global nav rail. `chat` is the focused app's workspace. */
export type MainPanel = 'apps' | 'chat' | 'code' | 'skills' | 'help' | 'settings'

/** A panel docked to the right of the workspace. */
export type RightPanel = 'versions' | null

/** A panel docked below the workspace. */
export type BottomPanel = 'terminal' | 'preview' | null
