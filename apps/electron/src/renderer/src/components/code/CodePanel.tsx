/**
 * The code panel: the sub-app's files, and one of them open.
 *
 * The app is a self-modifying editor whose renderer has, until now, had no way to read a
 * file at all — there was no `readFile` IPC. Everything the agent wrote could only be
 * seen by the person who ran the app afterwards. This is where you look at the code the
 * agent is working on while it works on it.
 */

import { useCallback, useEffect, useState } from 'react'
import { FileTree } from './FileTree'
import { CodeViewer } from './CodeViewer'
import { WarningIcon } from '../icons'
import type { FileDiagnostic, FileNode } from '../../types/electron'

/**
 * Props for the CodePanel component.
 */
interface CodePanelProps {
  /** Absolute path of the active sub-app, or null when none is selected. */
  appPath: string | null
}

/**
 * Renders the file tree beside a read-only view of the selected file.
 */
export function CodePanel({ appPath }: CodePanelProps) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState<string>('')
  const [diagnostics, setDiagnostics] = useState<FileDiagnostic[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appPath) {
      setTree([])
      return
    }
    let cancelled = false
    window.electronAPI
      .getFileTree(appPath)
      .then((nodes) => {
        if (!cancelled) setTree(nodes)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [appPath])

  const open = useCallback(
    (path: string) => {
      if (!appPath) return
      setSelected(path)
      setError(null)
      setDiagnostics([])

      window.electronAPI
        .readFile(path, appPath)
        .then((file) => setText(file.text))
        .catch((cause: Error) => {
          setText('')
          setError(cause.message)
        })

      // Diagnostics are fetched separately and allowed to arrive late: the first request
      // for an app pays for building the whole program, and blocking the file's text on
      // that would make every first open feel broken.
      window.electronAPI
        .getFileDiagnostics(path, appPath)
        .then(setDiagnostics)
        .catch(() => setDiagnostics([]))
    },
    [appPath]
  )

  if (!appPath) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-ash">Select an app to browse its code.</p>
      </div>
    )
  }

  const errors = diagnostics.filter((entry) => entry.category === 'error')

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-panel">
        <FileTree nodes={tree} selectedPath={selected} onSelect={open} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <span className="truncate font-mono text-xs text-bone">{selected}</span>
              {errors.length > 0 && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-rust">
                  <WarningIcon size={13} />
                  {errors.length} error{errors.length === 1 ? '' : 's'}
                </span>
              )}
            </header>

            {error ? (
              <p className="p-4 text-sm text-rust">{error}</p>
            ) : (
              <div className="min-h-0 flex-1">
                <CodeViewer path={selected} text={text} markers={diagnostics} />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-ash">Pick a file to read it.</p>
          </div>
        )}
      </section>
    </div>
  )
}
