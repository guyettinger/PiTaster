/**
 * The things you can do to the dock that are not dragging.
 *
 * Opening a panel from the Panels menu and opening a file from the tree are the
 * same operation with a different id, so they share one implementation: focus
 * what is already there, and only add when it is not.
 */

import { applyDefaultLayout } from './defaultLayout'
import { codePanelId, singletonPanelId } from './catalog'
import type { DockviewApi } from 'dockview-react'
import type { WorkspacePanelKind } from './catalog'

/**
 * Show a singleton panel, adding it if it is closed.
 *
 * A reopened panel joins the active group as a tab rather than claiming a split
 * of its own. That is the least surprising place for it: the user asked to see
 * it, not to rearrange what they had already arranged, and a tab is one drag
 * away from anywhere else.
 *
 * @param api - The dock's API
 * @param kind - The panel to show
 */
export function openSingletonPanel(api: DockviewApi, kind: WorkspacePanelKind): void {
  const id = singletonPanelId(kind.name)
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({
    id,
    component: kind.name,
    title: kind.title,
    renderer: 'always'
  })
}

/**
 * Close a singleton panel. A no-op when it is not open.
 * @param api - The dock's API
 * @param kind - The panel to close
 */
export function closeSingletonPanel(api: DockviewApi, kind: WorkspacePanelKind): void {
  api.getPanel(singletonPanelId(kind.name))?.api.close()
}

/**
 * Whether a singleton panel is currently in the layout.
 * @param api - The dock's API
 * @param kind - The panel to look for
 */
export function isPanelOpen(api: DockviewApi, kind: WorkspacePanelKind): boolean {
  return api.getPanel(singletonPanelId(kind.name)) !== undefined
}

/**
 * Open a file as its own Code panel, focusing it if it is already open.
 *
 * The path is both the id and the only `param`, which is what makes opening the
 * same file twice a focus rather than a duplicate — and it is a string, because
 * `params` are serialized into the saved layout.
 *
 * @param api - The dock's API
 * @param path - Path of the file, relative to the app root
 */
export function openCodePanel(api: DockviewApi, path: string): void {
  const id = codePanelId(path)
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({
    id,
    component: 'code',
    title: path.split('/').pop() ?? path,
    renderer: 'always',
    params: { path },
    // Beside the conversation when there is one, so reading code does not
    // displace the thing the workspace is for.
    position: api.getPanel('chat') ? { referencePanel: 'chat', direction: 'within' } : undefined
  })
}

/**
 * Throw the layout away and rebuild the default.
 * @param api - The dock's API
 */
export function resetLayout(api: DockviewApi): void {
  api.clear()
  applyDefaultLayout(api)
}
