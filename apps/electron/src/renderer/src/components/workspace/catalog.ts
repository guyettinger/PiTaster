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
   * Every panel but Code is a singleton, and not only for tidiness: each `off*`
   * in the preload bridge is `removeAllListeners(channel)`, so two panels
   * subscribed to one channel would tear down each other's stream on unmount.
   * Code is safe to duplicate because it subscribes to nothing — it fetches.
   * Making any other panel duplicable means fixing the bridge first.
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
  'preview'
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
