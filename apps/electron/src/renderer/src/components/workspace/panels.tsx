/**
 * The dock's panel registry.
 *
 * Each entry adapts a component that already exists to dockview's panel
 * interface: it reads what it needs from `WorkspaceContext` and renders the
 * component unchanged. They live in one module rather than one file each
 * because the mapping from a panel name to what it draws is the thing worth
 * reading in one place — the adapters themselves are mostly a line long.
 *
 * The two exceptions are Files and Code, which are what `CodePanel` used to be.
 * Making Code multi-instance splits it along the seam it already had: the tree
 * loads once, and each open file is its own panel that fetches its own text and
 * diagnostics.
 */

import { useEffect, useState } from 'react'
import type { FunctionComponent } from 'react'
import { Chat } from '../Chat'
import { ChatSessionList } from '../ChatSessionList'
import { VersionControl } from '../VersionControl'
import { TerminalPanel } from '../TerminalPanel'
import { PreviewPanel } from '../PreviewPanel'
import { AppServerBlock } from '../shell/AppServerBlock'
import { FileTree } from '../code/FileTree'
import { CodeViewer } from '../code/CodeViewer'
import { WarningIcon } from '../icons'
import { useWorkspace } from './WorkspaceContext'
import type { IDockviewPanelProps } from 'dockview-react'
import type { WorkspacePanelName } from './catalog'
import type { FileDiagnostic, FileNode } from '../../types/electron'

/**
 * `params` for a Code panel. The only panel parameter in the app, and a string
 * because everything in `params` is serialized into the saved layout.
 */
export interface CodePanelParams {
  /** Path of the open file, relative to the app root. */
  path: string
}

/**
 * The app's chat sessions.
 */
function ChatsPanel() {
  const { activeSessionId, onSessionSelect, onSessionCreate } = useWorkspace()
  return (
    <div className="h-full overflow-y-auto bg-panel">
      <ChatSessionList
        activeSessionId={activeSessionId}
        onSessionSelect={onSessionSelect}
        onSessionCreate={onSessionCreate}
      />
    </div>
  )
}

/**
 * The app's dev server.
 */
function ServerPanel() {
  const { app } = useWorkspace()
  return (
    <div className="h-full overflow-y-auto bg-panel">
      <AppServerBlock appId={app.id} template={app.template} />
    </div>
  )
}

/**
 * The conversation with the agent.
 */
function ChatPanel() {
  const { app, permissionMode, onModeChange, activeSessionId, onOpenSkills } = useWorkspace()
  return (
    <Chat
      app={app}
      permissionMode={permissionMode}
      onModeChange={onModeChange}
      activeSessionId={activeSessionId}
      onOpenSkills={onOpenSkills}
    />
  )
}

/**
 * Branches, commits and diffs.
 */
function HistoryPanel() {
  const { app, onRollback, onBranchSwitch, onBranchCreate } = useWorkspace()
  return (
    <div className="h-full bg-panel">
      <VersionControl
        appPath={app.path}
        onRollback={onRollback}
        onBranchSwitch={onBranchSwitch}
        onBranchCreate={onBranchCreate}
      />
    </div>
  )
}

/**
 * The dev server's output.
 *
 * `isVisible` is always true: with `renderer: 'always'` the dock hides a
 * background panel by setting `visibility` on its overlay, which keeps the
 * element's box — and so its `scrollHeight` — intact. Passing the panel's real
 * visibility would make it return null and unmount the scroller, losing the
 * scroll position the `always` renderer exists to preserve.
 */
function LogsPanel() {
  const { app } = useWorkspace()
  return <TerminalPanel appId={app.id} isVisible={true} />
}

/**
 * The running app, in a webview.
 *
 * Always visible, for the reason given on {@link LogsPanel} — and more sharply
 * here, since unmounting a `<webview>` destroys its `WebContents`.
 */
function PreviewDockPanel() {
  const { app } = useWorkspace()
  return <PreviewPanel appId={app.id} isVisible={true} />
}

/**
 * The app's files. Picking one opens it as its own Code panel.
 */
function FilesPanel() {
  const { app, openFile } = useWorkspace()
  const [tree, setTree] = useState<FileNode[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getFileTree(app.path)
      .then((nodes) => {
        if (!cancelled) setTree(nodes)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [app.path])

  if (error) {
    return <p className="p-3 text-sm text-rust">{error}</p>
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <FileTree nodes={tree} selectedPath={null} onSelect={openFile} />
    </div>
  )
}

/**
 * One open file.
 */
function CodeFilePanel({ params }: IDockviewPanelProps<CodePanelParams>) {
  const { app } = useWorkspace()
  const { path } = params
  const [text, setText] = useState('')
  const [diagnostics, setDiagnostics] = useState<FileDiagnostic[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDiagnostics([])

    window.electronAPI
      .readFile(path, app.path)
      .then((file) => {
        if (cancelled) return
        setText(file.text)
        setLoading(false)
      })
      .catch((cause: Error) => {
        if (cancelled) return
        setText('')
        setError(cause.message)
        setLoading(false)
      })

    // Diagnostics are fetched separately and allowed to arrive late: the first
    // request for an app pays for building the whole program, and blocking the
    // file's text on that would make every first open feel broken.
    window.electronAPI
      .getFileDiagnostics(path, app.path)
      .then((entries) => {
        if (!cancelled) setDiagnostics(entries)
      })
      .catch(() => {
        if (!cancelled) setDiagnostics([])
      })

    return () => {
      cancelled = true
    }
  }, [path, app.path])

  const errors = diagnostics.filter((entry) => entry.category === 'error')

  // A restored layout can name a file the agent has since deleted. Saying so is
  // better than quietly dropping the tab — the file going away is information.
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="font-mono text-xs text-ash">{path}</p>
        <p className="text-sm text-rust">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {errors.length > 0 && (
        <header className="flex shrink-0 items-center justify-end border-b border-line px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-xs text-rust">
            <WarningIcon size={13} />
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        </header>
      )}
      <div className="min-h-0 flex-1">
        {loading ? (
          <p className="p-3 text-sm text-ash">Reading {path}…</p>
        ) : (
          <CodeViewer path={path} text={text} markers={diagnostics} />
        )}
      </div>
    </div>
  )
}

/**
 * Every panel the dock can render, by component name.
 *
 * Typed against the catalog so a panel cannot be named there and left
 * unimplemented here, or the reverse. A saved layout names components from this
 * map, so removing or renaming a key invalidates layouts that reference it —
 * bump `LAYOUT_VERSION` when that happens.
 */
export const WORKSPACE_COMPONENTS: Record<
  WorkspacePanelName,
  FunctionComponent<IDockviewPanelProps>
> = {
  chats: ChatsPanel,
  files: FilesPanel,
  server: ServerPanel,
  chat: ChatPanel,
  code: CodeFilePanel,
  history: HistoryPanel,
  terminal: LogsPanel,
  preview: PreviewDockPanel
}
