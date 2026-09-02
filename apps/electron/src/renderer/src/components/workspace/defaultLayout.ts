import type { DockviewApi, Direction } from 'dockview-react'
import type { WorkspacePanelName } from './catalog'

/**
 * The layout schema version.
 *
 * A saved layout names panel components and ids. Bump this whenever that set
 * changes — adding a panel, renaming one, or changing what an id means — and
 * every layout saved against an older set is discarded in favour of the
 * default rather than restored into a shape it no longer describes.
 */
export const LAYOUT_VERSION = 1

/**
 * Where a panel sits relative to one added before it.
 */
export interface DefaultPanelPosition {
  /** The id of an earlier panel in the same list. */
  referencePanel: string
  /** Which side of it, or `within` to join its group as a tab. */
  direction: Direction
}

/**
 * One panel in the default workspace layout.
 */
export interface DefaultPanel {
  /** Panel id, unique within the layout. */
  id: string
  /** Which panel to render. */
  component: WorkspacePanelName
  /** The tab label. */
  title: string
  /** Where it goes. Omitted for the first panel, which seeds the grid. */
  position?: DefaultPanelPosition
  /** Width to give the group this panel creates, in pixels. */
  initialWidth?: number
  /** Height to give the group this panel creates, in pixels. */
  initialHeight?: number
  /**
   * Add without focusing. `addPanel` activates by default, so without this the
   * last panel added to a group is the tab you land on — which for the left
   * column would be Files and for the output row would be Preview, neither of
   * which is what you opened the app to look at.
   */
  inactive?: boolean
}

/**
 * Initial width of the sidebar, in pixels.
 *
 * It carries three lists now, and they wanted different widths on their own —
 * Chats read fine at 260, History's commit rows at 320. 300 is the width that
 * serves both without giving the sidebar a size it only needs on one tab.
 */
const SIDEBAR_WIDTH = 300

/** Initial height of the bottom row, in pixels. */
const OUTPUT_HEIGHT = 260

/**
 * The layout someone sees the first time they open an app.
 *
 * Ordered, and every `referencePanel` names a panel earlier in the list —
 * dockview resolves each position against what is already there, so the order
 * is part of the meaning rather than a detail. `defaultLayout.test.ts` holds
 * that invariant, because getting it wrong throws at runtime in `addPanel`
 * rather than at the type level.
 *
 * Three groups, each holding the tabs you alternate between rather than one
 * panel per region. The sidebar is what you *browse* — chats, files, commits.
 * The middle is the pair you work in, the conversation and the running app, so
 * checking what the agent just built is a tab away at full size. The bottom row
 * is the app's own machinery, where starting the server and reading what it
 * printed are one glance apart rather than in opposite corners.
 *
 * No Code panel — files open on demand, and a workspace that opened one before
 * you asked would be asserting you came here to read code rather than to talk to
 * the agent.
 */
export function defaultWorkspaceLayout(): DefaultPanel[] {
  return [
    { id: 'chat', component: 'chat', title: 'Chat' },
    {
      id: 'chats',
      component: 'chats',
      title: 'Chats',
      position: { referencePanel: 'chat', direction: 'left' },
      initialWidth: SIDEBAR_WIDTH
    },
    {
      id: 'files',
      component: 'files',
      title: 'Files',
      position: { referencePanel: 'chats', direction: 'within' },
      inactive: true
    },
    {
      id: 'history',
      component: 'history',
      title: 'History',
      position: { referencePanel: 'chats', direction: 'within' },
      inactive: true
    },
    {
      id: 'terminal',
      component: 'terminal',
      title: 'Terminal',
      position: { referencePanel: 'chat', direction: 'below' },
      initialHeight: OUTPUT_HEIGHT
    },
    {
      id: 'server',
      component: 'server',
      title: 'Server',
      position: { referencePanel: 'terminal', direction: 'within' },
      inactive: true
    },
    {
      id: 'preview',
      component: 'preview',
      title: 'Preview',
      position: { referencePanel: 'chat', direction: 'within' },
      inactive: true
    }
  ]
}

/**
 * Build the default layout into an empty dock.
 *
 * Every panel is added with `renderer: 'always'`, which is the whole reason
 * dockview is a fit here: it keeps a panel's element attached to one stable
 * overlay and repositions it, so docking never re-parents the DOM. The Preview
 * panel's `<webview>` would otherwise lose its `WebContents` on every drag, and
 * the transcript would lose its scroll position every time it went to the
 * background.
 *
 * @param api - The dock's API, which the caller must have already cleared
 */
export function applyDefaultLayout(api: DockviewApi): void {
  for (const panel of defaultWorkspaceLayout()) {
    api.addPanel({
      id: panel.id,
      component: panel.component,
      title: panel.title,
      renderer: 'always',
      position: panel.position,
      initialWidth: panel.initialWidth,
      initialHeight: panel.initialHeight,
      inactive: panel.inactive
    })
  }

  // Sizes ride on `addPanel` rather than being set afterwards. A group sized
  // after the fact is immediately renegotiated by the next split, which is why
  // the first attempt at this produced an even-looking grid no matter what
  // numbers it asked for.
  api.getPanel('chat')?.api.setActive()
}
