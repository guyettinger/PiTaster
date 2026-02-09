import { useState, useEffect, useCallback } from 'react'
import type { ChatSession } from '@anyapp/core'

/**
 * Props for the ChatSessionList component.
 */
interface ChatSessionListProps {
  /** Currently active session ID. */
  activeSessionId: string | null
  /** Callback when a session is selected. */
  onSessionSelect: (sessionId: string) => void
  /** Callback when a new session is created. */
  onSessionCreate: () => void
}

/**
 * Sidebar list showing all chat sessions for the active app.
 * Supports create, rename, and delete actions.
 */
export function ChatSessionList({
  activeSessionId,
  onSessionSelect,
  onSessionCreate
}: ChatSessionListProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  // Load sessions on mount and listen for updates
  useEffect(() => {
    window.electronAPI.listChatSessions().then(setSessions).catch(() => {})

    window.electronAPI.onSessionsListUpdated(setSessions)
    return () => {
      window.electronAPI.offSessionsListUpdated()
    }
  }, [])

  const handleDelete = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    await window.electronAPI.deleteChatSession(sessionId)
    // Refresh sessions list
    const updated = await window.electronAPI.listChatSessions()
    setSessions(updated)
  }, [])

  const handleRenameStart = useCallback((e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title)
  }, [])

  const handleRenameConfirm = useCallback(
    async (sessionId: string) => {
      if (editTitle.trim()) {
        await window.electronAPI.renameChatSession(sessionId, editTitle.trim())
        const updated = await window.electronAPI.listChatSessions()
        setSessions(updated)
      }
      setEditingId(null)
    },
    [editTitle]
  )

  // Sort sessions by updatedAt (most recent first)
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  return (
    <div className="flex h-full flex-col border-r border-neutral-800 w-56">
      {/* Header with New Chat button */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Sessions
        </span>
        <button
          onClick={onSessionCreate}
          className="rounded px-2 py-1 text-xs text-blue-400 hover:bg-neutral-800 hover:text-blue-300"
          title="New Chat Session"
        >
          + New
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto">
        {sortedSessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-neutral-600">No sessions yet</div>
        ) : (
          sortedSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSessionSelect(session.id)}
              className={`group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                session.id === activeSessionId
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
              }`}
            >
              {editingId === session.id ? (
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleRenameConfirm(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameConfirm(session.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  className="flex-1 rounded bg-neutral-700 px-1 py-0.5 text-sm text-neutral-100 outline-none"
                />
              ) : (
                <>
                  <div className="flex-1 truncate">
                    <div className="truncate">{session.title}</div>
                    <div className="text-[10px] text-neutral-600">
                      {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Actions — visible on hover */}
                  <div className="hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={(e) => handleRenameStart(e, session)}
                      className="rounded p-0.5 text-xs text-neutral-500 hover:text-neutral-300"
                      title="Rename"
                    >
                      &#9998;
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      className="rounded p-0.5 text-xs text-neutral-500 hover:text-red-400"
                      title="Delete"
                    >
                      &#10005;
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
