import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelToggle } from './PanelToggle'
import {
  ChatIcon,
  DaemonIcon,
  FileEditIcon,
  FolderIcon,
  HistoryIcon,
  LayoutIcon,
  PlayIcon,
  PreviewIcon,
  PulseIcon,
  SkillsIcon,
  SourceIcon,
  TerminalIcon
} from '../icons'
import { WORKSPACE_PANEL_KINDS } from '../workspace/catalog'
import {
  closeSingletonPanel,
  isPanelOpen,
  openSingletonPanel,
  resetLayout
} from '../workspace/actions'
import type { ReactNode } from 'react'
import type { DockviewApi } from 'dockview-react'
import type { WorkspacePanelName } from '../workspace/catalog'

/**
 * A glyph per panel.
 *
 * Here rather than in the catalog because the catalog is deliberately free of
 * React — it is imported by tests that have no DOM to render into.
 */
const PANEL_ICONS: Record<WorkspacePanelName, ReactNode> = {
  chat: <ChatIcon size={16} />,
  chats: <SourceIcon size={16} />,
  files: <FolderIcon size={16} />,
  server: <PlayIcon size={16} />,
  code: <FolderIcon size={16} />,
  history: <HistoryIcon size={16} />,
  terminal: <TerminalIcon size={16} />,
  preview: <PreviewIcon size={16} />,
  activity: <PulseIcon size={16} />,
  daemon: <DaemonIcon size={16} />,
  changes: <FileEditIcon size={16} />,
  skills: <SkillsIcon size={16} />
}

/**
 * Props for the PanelsMenu component.
 */
interface PanelsMenuProps {
  /** The dock's API, or null until it is ready. */
  api: DockviewApi | null
}

/**
 * Opens, closes and resets the workspace's panels.
 *
 * A dock you can drag panels out of needs a way to get them back — otherwise
 * closing a tab is a one-way door and the only recovery is to know that
 * resetting exists. This is that way back, and it lists only the singletons:
 * Code panels are files, and you reopen a file from the tree.
 */
export function PanelsMenu({ api }: PanelsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // The menu mutates the layout it is drawn from, and dockview's changes do not
  // pass through React state, so the open/closed ring beside each row would go
  // stale the moment you used it. Re-rendering on every layout change is what
  // keeps the menu describing the dock rather than describing it as it was.
  const [, setRevision] = useState(0)
  useEffect(() => {
    if (!api || !isOpen) return
    const disposable = api.onDidLayoutChange(() => setRevision((n) => n + 1))
    return () => disposable.dispose()
  }, [api, isOpen])

  // A menu outlives the click that opened it, so it needs the two ways out
  // every other pinned surface in the app has: Escape, and a click elsewhere.
  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setIsOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    // Capture, so a click a child stops from bubbling still closes the menu.
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isOpen])

  const handleReset = useCallback(() => {
    if (!api) return
    resetLayout(api)
    setIsOpen(false)
  }, [api])

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={!api}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Panels"
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[13px] text-ash transition-colors hover:bg-raised/60 hover:text-bone disabled:opacity-40"
      >
        <LayoutIcon size={16} />
        Panels
      </button>

      {isOpen && api && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-line bg-panel p-2 shadow-lg">
          {WORKSPACE_PANEL_KINDS.filter((kind) => kind.singleton).map((kind) => {
            const open = isPanelOpen(api, kind)
            return (
              <PanelToggle
                key={kind.name}
                icon={PANEL_ICONS[kind.name]}
                label={kind.title}
                open={open}
                onClick={() =>
                  open ? closeSingletonPanel(api, kind) : openSingletonPanel(api, kind)
                }
              />
            )
          })}

          <div className="my-1 border-t border-line" />

          <button
            onClick={handleReset}
            className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ash transition-colors hover:bg-raised/60 hover:text-bone"
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  )
}
