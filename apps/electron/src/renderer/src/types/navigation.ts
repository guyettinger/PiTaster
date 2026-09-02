/**
 * Shell navigation state.
 *
 * There is only one kind of navigation left. Docked panels used to be the other
 * kind — a fixed right rail and a bottom drawer, toggled from the app's column —
 * and they are now panels in the workspace's dock, arranged by dragging rather
 * than named by a type. What remains is the set of places the nav rail can take
 * you.
 *
 * `workspace` is the focused app itself. The others exist without an app, which
 * is why none of them is ever disabled; `workspace` with no app focused shows
 * the empty state rather than being unreachable.
 */

/** A destination in the global nav rail. */
export type Destination = 'apps' | 'workspace' | 'skills' | 'help' | 'settings'
