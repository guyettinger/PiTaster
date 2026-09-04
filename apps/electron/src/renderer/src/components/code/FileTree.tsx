/**
 * The sub-app's source tree.
 *
 * What it shows is exactly what the agent can reach: the main process builds it through
 * the same `isWithinRoot` the permission gate uses, and skips `node_modules` and build
 * output. So the tree is not a view of the disk, it is a view of *the app* — which is
 * the thing the user is reasoning about when they open this panel.
 */

import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from '../icons'
import type { FileNode } from '../../types/electron'

/**
 * Props for the FileTree component.
 */
interface FileTreeProps {
  /** The tree's top-level entries. */
  nodes: FileNode[]
  /** The path currently open in the viewer. */
  selectedPath: string | null
  /** Called when the user picks a file. */
  onSelect: (path: string) => void
}

/**
 * Props for one row of the tree.
 */
interface FileTreeNodeProps {
  /** The entry to draw. */
  node: FileNode
  /** How deep it sits, for indentation. */
  depth: number
  /** The path currently open in the viewer. */
  selectedPath: string | null
  /** Called when the user picks a file. */
  onSelect: (path: string) => void
}

/**
 * One file or directory, and its children when expanded.
 */
function FileTreeNode({ node, depth, selectedPath, onSelect }: FileTreeNodeProps) {
  // `src` open by default: on every template Pi Taster ships it is where the code is, and
  // making the user open it every time to reach the file they came for is friction with
  // nothing on the other side of it.
  const [isOpen, setIsOpen] = useState(depth === 0 && node.name === 'src')
  const isSelected = node.path === selectedPath

  if (node.kind === 'file') {
    return (
      <button
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors ${
          isSelected ? 'bg-raised text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
        }`}
      >
        <FileIcon size={13} />
        <span className="truncate">{node.name}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-ash transition-colors hover:bg-raised/60 hover:text-bone"
      >
        {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <FolderIcon size={13} />
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

/**
 * Renders a sub-app's source tree.
 */
export function FileTree({ nodes, selectedPath, onSelect }: FileTreeProps) {
  if (nodes.length === 0) {
    return <p className="p-3 text-xs text-ash">This app has no files yet.</p>
  }

  return (
    <div className="py-1">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
