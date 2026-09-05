import { useState, useEffect, useCallback, useMemo } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from './icons'
import { formatCompactTime, dayBucketOf, DAY_BUCKETS, type DayBucket } from '../lib/relativeTime'
import type { ChatSession } from '@keylimepi/core'

/** The title a session carries until it has a message to be named after. */
const UNTITLED_SESSION = 'New Chat'

/**
 * The longest title the rename box accepts.
 *
 * Mirrors `MAX_SESSION_TITLE_CHARS` in `@keylimepi/shared`, which is where the bound
 * is actually enforced — main re-checks it, and so does `ChatHistoryManager` at the
 * write. This copy exists so an honest rename is stopped at the keyboard rather than
 * rejected by IPC with nothing on screen to explain it.
 */
const MAX_TITLE_CHARS = 200

/**
 * Props for the ChatSessionList component.
 */
interface ChatSessionListProps {
  /** The app whose sessions these are. */
  appId: string
  /** Currently active session ID. */
  activeSessionId: string | null
  /** Callback when a session is selected. */
  onSessionSelect: (sessionId: string) => void
  /** Callback when a new session is created. */
  onSessionCreate: () => void
}

/**
 * One day's worth of sessions, under the heading it will be listed beneath.
 */
interface SessionGroup {
  /** The heading. */
  bucket: DayBucket
  /** The sessions in it, newest first. */
  sessions: ChatSession[]
}

/**
 * The focused app's chats, rendered as a panel in the workspace dock.
 *
 * The column owns the frame — width, background, and borders — so this
 * component contributes only its own content and scroll area.
 *
 * The list is a pure subscriber: every change to a session, wherever it
 * originates, arrives as `sessions:list-updated` from the main process. Refetching
 * locally after an action would race that event and show one of the two answers at
 * random.
 */
export function ChatSessionList({
  appId,
  activeSessionId,
  onSessionSelect,
  onSessionCreate
}: ChatSessionListProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  // The row whose delete button is armed. Deleting a transcript is not undoable
  // and the button is two pixels from rename, so it takes a second press.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  // Load sessions on mount and listen for updates
  useEffect(() => {
    window.electronAPI.listChatSessions(appId).then(setSessions).catch(() => {})

    return window.electronAPI.onSessionsListUpdated(appId, setSessions)
  }, [appId])

  const handleDelete = useCallback(
    async (sessionId: string) => {
      if (confirmingDeleteId !== sessionId) {
        setConfirmingDeleteId(sessionId)
        return
      }
      setConfirmingDeleteId(null)
      await window.electronAPI.deleteChatSession(sessionId, appId)
    },
    [appId, confirmingDeleteId]
  )

  const handleRenameStart = useCallback((session: ChatSession) => {
    setConfirmingDeleteId(null)
    setEditingId(session.id)
    // An untitled chat starts empty rather than with the placeholder, so the first
    // keystroke replaces it instead of appending to it.
    setEditTitle(session.title === UNTITLED_SESSION ? '' : session.title)
  }, [])

  const handleRenameConfirm = useCallback(
    async (sessionId: string) => {
      const title = editTitle.trim()
      setEditingId(null)
      if (title) {
        await window.electronAPI.renameChatSession(sessionId, title, appId)
      }
    },
    [appId, editTitle]
  )

  // Sorted by recency, then split into the day headings that make that order
  // visible. Rows are otherwise near-identical, and an ordering nobody can see is
  // indistinguishable from no ordering at all.
  const groups = useMemo<SessionGroup[]>(() => {
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return DAY_BUCKETS.map((bucket) => ({
      bucket,
      sessions: sorted.filter((session) => dayBucketOf(session.updatedAt) === bucket)
    })).filter((group) => group.sessions.length > 0)
  }, [sessions])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseLeave={() => setConfirmingDeleteId(null)}
    >
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
        {groups.length === 0 ? (
          <p className="px-2 py-2 text-[12px] leading-snug text-ash">
            No chats yet. Start one to keep this app&rsquo;s history separate.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.bucket}>
              <h3 className="eyebrow px-2 pb-1 pt-3 text-ash first:pt-1">{group.bucket}</h3>
              <ul>
                {group.sessions.map((session) => {
                  const isActive = session.id === activeSessionId
                  const isUntitled = session.title === UNTITLED_SESSION
                  const isConfirming = confirmingDeleteId === session.id

                  return (
                    <li
                      key={session.id}
                      className={`group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                        isActive ? 'bg-raised text-bone' : 'text-ash hover:bg-raised/60 hover:text-bone'
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
                          maxLength={MAX_TITLE_CHARS}
                          placeholder={UNTITLED_SESSION}
                          aria-label={`Rename ${session.title}`}
                          className="min-w-0 flex-1 rounded bg-line px-1 py-0.5 text-[13px] text-bone"
                        />
                      ) : (
                        <>
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isActive ? 'bg-keylime' : 'bg-transparent'
                            }`}
                          />
                          {/*
                           * The row opens the chat, but the control that does it is
                           * this one button, stretched over the row by its `::after`
                           * — same pattern as the app cards. Rename and delete stay
                           * siblings above it, so the row is one tab stop and they
                           * are two more, rather than an unreachable div.
                           */}
                          <button
                            onClick={() => onSessionSelect(session.id)}
                            aria-current={isActive ? 'true' : undefined}
                            title={session.title}
                            className={`min-w-0 flex-1 cursor-pointer truncate text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-1 focus-visible:after:outline-keylime ${
                              // A chat with nothing in it reads as empty rather than
                              // as one that happens to be named "New Chat".
                              isUntitled ? 'text-ash' : ''
                            }`}
                          >
                            {session.title}
                          </button>

                          {/*
                           * Time, not message count. Pi counts every transcript entry
                           * including tool results, so the count was several times
                           * what the chat shows — and the recency it stood in for is
                           * what the reader actually wants from this column.
                           *
                           * Hidden while the row's actions are showing: they occupy
                           * the same corner, and swapping one for the other keeps the
                           * title's width from moving.
                           */}
                          <span className="shrink-0 text-[10px] tabular-nums text-ash group-hover:hidden group-focus-within:hidden">
                            {formatCompactTime(session.updatedAt)}
                          </span>

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
                              onBlur={() => setConfirmingDeleteId(null)}
                              className={`rounded p-1 transition-colors ${
                                isConfirming ? 'text-rust' : 'text-ash hover:text-rust'
                              }`}
                              aria-label={
                                isConfirming
                                  ? `Confirm deleting ${session.title}`
                                  : `Delete ${session.title}`
                              }
                              title={isConfirming ? 'Press again to delete' : 'Delete chat'}
                            >
                              <TrashIcon size={13} />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
