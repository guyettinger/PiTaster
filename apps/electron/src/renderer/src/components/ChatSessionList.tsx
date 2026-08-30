import { useState, useEffect, useCallback } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from './icons'
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
 * The focused app's chats, rendered inside `AppContextColumn`.
 *
 * The column owns the frame — width, background, and borders — so this
 * component contributes only its own content and scroll area.
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="eyebrow text-ash">Chats</span>
        <button
          onClick={onSessionCreate}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ash transition-colors hover:bg-raised hover:text-bone"
          title="Start a new chat"
        >
          <PlusIcon size={12} />
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sortedSessions.length === 0 ? (
          <p className="px-1.5 py-2 text-[12px] leading-snug text-ash">
            No chats yet. Start one to keep this app&rsquo;s history separate.
          </p>
        ) : (
          sortedSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSessionSelect(session.id)}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                session.id === activeSessionId
                  ? 'bg-raised text-bone'
                  : 'text-ash hover:bg-raised/60 hover:text-bone'
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
                  className="min-w-0 flex-1 rounded bg-line px-1 py-0.5 text-[13px] text-bone"
                />
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.id === activeSessionId ? 'bg-brass' : 'bg-transparent'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{session.title}</div>
                    <div className="text-[10px] text-ash">
                      {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={(e) => handleRenameStart(e, session)}
                      className="rounded p-0.5 text-ash transition-colors hover:text-bone"
                      title="Rename chat"
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      className="rounded p-0.5 text-ash transition-colors hover:text-rust"
                      title="Delete chat"
                    >
                      <TrashIcon size={13} />
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
