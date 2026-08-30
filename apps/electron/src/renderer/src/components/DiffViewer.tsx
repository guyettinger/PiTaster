/**
 * Props for the DiffViewer component.
 */
interface DiffViewerProps {
  /** Old file content. */
  oldContent: string
  /** New file content. */
  newContent: string
  /** File name to display. */
  filename: string
}

/**
 * Side-by-side diff viewer component.
 */
export function DiffViewer({ oldContent, newContent, filename }: DiffViewerProps) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  return (
    <div className="overflow-hidden rounded border border-line font-mono text-sm">
      {/* Header */}
      <div className="flex border-b border-line bg-panel px-3 py-2">
        <span className="text-ash">{filename}</span>
      </div>

      <div className="flex">
        {/* Old (left) */}
        <div className="flex-1 border-r border-line">
          <div className="bg-rust/10 px-2 py-1 text-xs text-rust">Previous</div>
          <pre className="max-h-80 overflow-auto p-2">
            {oldLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 select-none pr-2 text-right text-ash">{i + 1}</span>
                <span className="text-bone">{line || ' '}</span>
              </div>
            ))}
          </pre>
        </div>

        {/* New (right) */}
        <div className="flex-1">
          <div className="bg-patina/10 px-2 py-1 text-xs text-patina">Current</div>
          <pre className="max-h-80 overflow-auto p-2">
            {newLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 select-none pr-2 text-right text-ash">{i + 1}</span>
                <span className="text-bone">{line || ' '}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  )
}

/**
 * Props for the FileDiffList component.
 */
interface FileDiffListProps {
  /** List of file diffs. */
  diffs: Array<{
    path: string
    type: 'add' | 'modify' | 'delete'
    oldContent?: string
    newContent?: string
  }>
}

/**
 * List of file diffs with expandable details.
 */
export function FileDiffList({ diffs }: FileDiffListProps) {
  if (diffs.length === 0) {
    return <p className="text-sm text-ash">No changes</p>
  }

  return (
    <div className="space-y-2">
      {diffs.map((diff) => (
        <div key={diff.path} className="rounded border border-line bg-panel">
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                diff.type === 'add'
                  ? 'bg-patina/10 text-patina'
                  : diff.type === 'delete'
                    ? 'bg-rust/10 text-rust'
                    : 'bg-brass/10 text-brass'
              }`}
            >
              {diff.type === 'add' ? 'A' : diff.type === 'delete' ? 'D' : 'M'}
            </span>
            <span className="font-mono text-sm text-bone">{diff.path}</span>
          </div>
          {diff.oldContent !== undefined && diff.newContent !== undefined && (
            <div className="border-t border-line">
              <DiffViewer
                oldContent={diff.oldContent}
                newContent={diff.newContent}
                filename={diff.path}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
