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
    <div className="overflow-hidden rounded border border-neutral-800 font-mono text-sm">
      {/* Header */}
      <div className="flex border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <span className="text-neutral-400">{filename}</span>
      </div>

      <div className="flex">
        {/* Old (left) */}
        <div className="flex-1 border-r border-neutral-800">
          <div className="bg-red-900/30 px-2 py-1 text-xs text-red-400">Previous</div>
          <pre className="max-h-80 overflow-auto p-2">
            {oldLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 select-none pr-2 text-right text-neutral-600">{i + 1}</span>
                <span className="text-neutral-300">{line || ' '}</span>
              </div>
            ))}
          </pre>
        </div>

        {/* New (right) */}
        <div className="flex-1">
          <div className="bg-green-900/30 px-2 py-1 text-xs text-green-400">Current</div>
          <pre className="max-h-80 overflow-auto p-2">
            {newLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 select-none pr-2 text-right text-neutral-600">{i + 1}</span>
                <span className="text-neutral-300">{line || ' '}</span>
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
    return <p className="text-sm text-neutral-500">No changes</p>
  }

  return (
    <div className="space-y-2">
      {diffs.map((diff) => (
        <div key={diff.path} className="rounded border border-neutral-800 bg-neutral-900">
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                diff.type === 'add'
                  ? 'bg-green-900/50 text-green-400'
                  : diff.type === 'delete'
                    ? 'bg-red-900/50 text-red-400'
                    : 'bg-yellow-900/50 text-yellow-400'
              }`}
            >
              {diff.type === 'add' ? 'A' : diff.type === 'delete' ? 'D' : 'M'}
            </span>
            <span className="font-mono text-sm text-neutral-300">{diff.path}</span>
          </div>
          {diff.oldContent !== undefined && diff.newContent !== undefined && (
            <div className="border-t border-neutral-800">
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
