/**
 * Every file this conversation has changed, with its diff.
 */

import { useMemo, useState } from 'react'
import { ChangedFileList, collectChangedFiles } from '../ChangedFilesStrip'
import { useSessionChanges } from '../../hooks/useSessionChanges'
import { useAgentActivity } from '../../state/agentActivity'
import { useWorkspace } from './WorkspaceContext'

/**
 * What the session touched, at full height.
 *
 * The same rows the Changes gauge shows in its card, given room to have their diffs
 * open. That is the only difference between the two, and it is a property of where they
 * are rendered rather than of what they render — which is why the list is one component
 * used twice rather than two lists that would drift.
 *
 * It measures **git, not tool calls**. A file the agent wrote five times is one row with
 * one net diff, and a file the *user* edited by hand appears at all; neither is true of
 * a list built from what the transcript reported.
 *
 * The refetch is keyed on two revisions because HEAD moves for two unrelated reasons: a
 * turn ending, which this panel learns from the activity store, and a rollback or branch
 * switch in the History panel, which arrives on the workspace context.
 */
export function ChangesPanel() {
  const { app, activeSessionId, openFile, changesRevision } = useWorkspace()
  const { turnRevision, pendingPaths, writingPath } = useAgentActivity()
  const [expanded, setExpanded] = useState<string | null>(null)

  const changes = useSessionChanges({
    appId: app.id,
    appPath: app.path,
    sessionId: activeSessionId,
    revision: turnRevision + changesRevision
  })

  const files = useMemo(
    () =>
      collectChangedFiles({
        patches: changes.patches,
        committedPaths: changes.committedPaths,
        uncommitted: changes.uncommitted,
        pendingPaths
      }),
    [changes.patches, changes.committedPaths, changes.uncommitted, pendingPaths]
  )

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-ash">
          {writingPath
            ? `Writing ${writingPath}…`
            : 'Nothing has changed in this conversation yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      {writingPath && (
        <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-keylime">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-keylime" />
          <span className="truncate font-mono">Writing {writingPath}</span>
        </p>
      )}
      <ChangedFileList
        files={files}
        expanded={expanded}
        onToggle={setExpanded}
        onOpen={openFile}
      />
    </div>
  )
}
