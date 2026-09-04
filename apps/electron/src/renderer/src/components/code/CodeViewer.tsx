/**
 * A read-only Monaco editor for one file.
 *
 * Read-only is a deliberate limit, not an unfinished one. The agent writes to these
 * files continuously and every write auto-commits; letting a person type into the same
 * buffer raises a real question about what happens when both change a file in the same
 * second, and that question deserves its own design rather than a `readOnly: false`.
 *
 * Diagnostics are applied as markers from Pi Taster's own language service — the same one
 * that appends errors to the agent's writes — so the squiggles the human sees and the
 * errors the model reads are the same facts. Monaco's own TypeScript service is not
 * registered; see `lib/monaco.ts` for why.
 */

import { useEffect, useRef } from 'react'
import { languageFor, setupMonaco } from '../../lib/monaco'
import type { editor } from 'monaco-editor'

/**
 * Props for the CodeViewer component.
 */
interface CodeViewerProps {
  /** Path of the open file, relative to the app root. */
  path: string
  /** The file's text. */
  text: string
  /** Compiler errors in this file, if any have been fetched. */
  markers?: Array<{
    /** 1-indexed line. */
    line: number
    /** 1-indexed column. */
    column: number
    /** The compiler's message. */
    message: string
    /** How serious it is. */
    category: 'error' | 'warning'
  }>
}

/**
 * Renders one file, read-only, with syntax highlighting and real diagnostics.
 */
export function CodeViewer({ path, text, markers }: CodeViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const monaco = setupMonaco()
    const instance = monaco.editor.create(host, {
      value: text,
      language: languageFor(path),
      theme: 'pitaster',
      readOnly: true,
      // The overview ruler and minimap are for navigating a file you are editing. In a
      // viewer they are chrome that eats width the code could use.
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      lineNumbersMinChars: 3,
      renderLineHighlight: 'none',
      automaticLayout: true,
      padding: { top: 8, bottom: 8 }
    })
    editorRef.current = instance

    return () => {
      // Disposing the model as well as the editor: Monaco keeps models in a global
      // registry keyed by URI, and leaving them behind leaks a copy of every file the
      // user has opened for the lifetime of the window.
      instance.getModel()?.dispose()
      instance.dispose()
      editorRef.current = null
    }
    // Deliberately mounted once per file. Changing the text of an existing model would
    // keep the scroll position from the previous file, which reads as a rendering bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Text can arrive after the editor exists — a file re-read after the agent wrote it.
  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model && model.getValue() !== text) model.setValue(text)
  }, [text])

  useEffect(() => {
    const monaco = setupMonaco()
    const model = editorRef.current?.getModel()
    if (!model) return

    monaco.editor.setModelMarkers(
      model,
      'pitaster',
      (markers ?? []).map((marker) => ({
        startLineNumber: marker.line,
        startColumn: marker.column,
        endLineNumber: marker.line,
        // The service reports a position, not a span. Marking to the end of the line is
        // honest about that — a one-character squiggle would imply a precision the
        // underline does not have.
        endColumn: model.getLineMaxColumn(marker.line),
        message: marker.message,
        severity:
          marker.category === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning
      }))
    )
  }, [markers, text])

  return <div ref={hostRef} className="h-full w-full" />
}
