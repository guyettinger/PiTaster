/**
 * What panels the dock has, named and described.
 *
 * This is deliberately free of React and of `window.electronAPI`: the default
 * layout, the Panels menu and the tests all need to know what a panel is
 * called, and importing `panels.tsx` to find out would drag Monaco and the
 * whole transcript tree in with it — which a `bun:test` run, having no DOM,
 * cannot even load.
 */

/**
 * A kind of panel the dock can render.
 */
export interface WorkspacePanelKind {
  /** The component name, as used in a saved layout. */
  name: WorkspacePanelName
  /** The tab label, and the label in the Panels menu. */
  title: string
  /**
   * Whether exactly one may exist.
   *
   * This used to be forced by the preload bridge: each `off*` was
   * `removeAllListeners(channel)`, so two panels on one channel tore down each
   * other's stream on unmount, and Code was duplicable only because it
   * subscribes to nothing — it fetches. The bridge now returns a teardown that
   * removes the exact handler, so that constraint is gone.
   *
   * What remains is a product decision rather than a technical one. Two Chats in
   * one workspace would be two views of the same conversation, both scrolling
   * and both accepting input, which is a worse thing to hand someone than a tab
   * they can drag. Panels that would genuinely benefit from duplication can now
   * simply be marked non-singleton.
   */
  singleton: boolean
}

/** Every component name the dock can render. */
export const WORKSPACE_PANEL_NAMES = [
  'chats',
  'files',
  'server',
  'chat',
  'code',
  'history',
  'terminal',
  'preview',
  'activity',
  'daemon',
  'changes',
  'skills'
] as const

/** A component name the dock can render. */
export type WorkspacePanelName = (typeof WORKSPACE_PANEL_NAMES)[number]

/**
 * The catalog, in the order the Panels menu lists it.
 */
export const WORKSPACE_PANEL_KINDS: readonly WorkspacePanelKind[] = [
  { name: 'chat', title: 'Chat', singleton: true },
  { name: 'chats', title: 'Chats', singleton: true },
  { name: 'files', title: 'Files', singleton: true },
  { name: 'server', title: 'Server', singleton: true },
  { name: 'history', title: 'History', singleton: true },
  { name: 'terminal', title: 'Terminal', singleton: true },
  { name: 'preview', title: 'Preview', singleton: true },
  { name: 'activity', title: 'Activity', singleton: true },
  { name: 'daemon', title: 'Daemon', singleton: true },
  { name: 'changes', title: 'Changes', singleton: true },
  { name: 'skills', title: 'Skills', singleton: true },
  { name: 'code', title: 'Code', singleton: false }
]

/**
 * The panel id for a singleton kind. Its name doubles as its id, which is what
 * makes "is this open?" a lookup rather than a search.
 */
export function singletonPanelId(name: WorkspacePanelName): string {
  return name
}

/**
 * The panel id for one open file.
 *
 * Prefixed so it cannot collide with a singleton's id, and carrying the path so
 * opening the same file twice focuses the panel that is already there.
 * @param path - Path of the file, relative to the app root
 */
export function codePanelId(path: string): string {
  return `code:${path}`
}
