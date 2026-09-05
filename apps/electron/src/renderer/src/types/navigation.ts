/**
 * Shell navigation state.
 *
 * There is only one kind of navigation left. Docked panels used to be the other
 * kind — a fixed right rail and a bottom drawer, toggled from the app's column —
 * and they are now panels in the workspace's dock, arranged by dragging rather
 * than named by a type. What remains is the set of places the nav rail can take
 * you.
 *
 * A focused app is **not** one of them. It used to be — `workspace` was a
 * destination, and `skills` beside it — but a destination replaces the main view
 * and an app does not: its workspace stays mounted underneath whatever covers
 * it. So a focused app is the *absence* of a destination, and `null` is what the
 * shell holds while one is showing. Every destination here exists without an
 * app, which is why none of them is ever disabled.
 */

/** A destination in the global nav rail. */
export type Destination = 'apps' | 'help' | 'settings'
