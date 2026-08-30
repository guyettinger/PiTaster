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

  const handleDelete = useCallback(async (sessionId: string) => {
    await window.electronAPI.deleteChatSession(sessionId)
    // Refresh sessions list
    const updated = await window.electronAPI.listChatSessions()
    setSessions(updated)
  }, [])

  const handleRenameStart = useCallback((session: ChatSession) => {
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
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="eyebrow text-ash">Chats</span>
        <button
          onClick={onSessionCreate}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ash transition-colors hover:bg-raised hover:text-bone"
          title="Start a new chat"
        >
          <PlusIcon size={12} />
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sortedSessions.length === 0 ? (
          <p className="px-2 py-2 text-[12px] leading-snug text-ash">
            No chats yet. Start one to keep this app&rsquo;s history separate.
          </p>
        ) : (
          <ul>
            {sortedSessions.map((session) => (
              <li
                key={session.id}
                className={`group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
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
                    aria-label={`Rename ${session.title}`}
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
                      {/*
                       * The row opens the chat, but the control that does it is
                       * this one button, stretched over the row by its `::after`
                       * — same pattern as the app cards. Rename and delete stay
                       * siblings above it, so the row is one tab stop and they
                       * are two more, rather than an unreachable div.
                       */}
                      <button
                        onClick={() => onSessionSelect(session.id)}
                        aria-current={session.id === activeSessionId ? 'true' : undefined}
                        className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-1 focus-visible:after:outline-brass"
                      >
                        {session.title}
                      </button>
                      <div className="text-[10px] text-ash">
                        {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                      </div>
                    </div>

                    {/*
                     * Revealed on focus as well as hover — hover-only would put
                     * rename and delete permanently out of reach of a keyboard.
                     */}
                    <div className="relative z-10 hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                      <button
                        onClick={() => handleRenameStart(session)}
                        className="rounded p-1 text-ash transition-colors hover:text-bone"
                        aria-label={`Rename ${session.title}`}
                        title="Rename chat"
                      >
                        <PencilIcon size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="rounded p-1 text-ash transition-colors hover:text-rust"
                        aria-label={`Delete ${session.title}`}
                        title="Delete chat"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
