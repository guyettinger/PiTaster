# Session 11 Notes: Multiple Chat Sessions

## Implementation Summary

Session 11 adds support for multiple named chat sessions per app. Users can create, rename, delete, and switch between conversation threads, each with independent message history and Claude conversation context.

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/chat.ts` | Added `ChatSession`, `ChatSessionManifest`, `CreateChatSessionParams` types |
| `packages/core/src/messages.ts` | Deprecated unused `Session` type |
| `packages/shared/src/chat/manager.ts` | Full rewrite: session-aware CRUD, manifest management, migration logic |
| `apps/electron/src/main/ipc.ts` | Added `activeSessionId` state, 6 new session handlers, updated chat handlers, extracted `rebuildConversationHistory` helper |
| `apps/electron/src/preload/index.ts` | Added `ChatSession`/`CreateChatSessionParams` types, 10 new API methods |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Extended `ElectronAPI` with session methods, added type exports |
| `apps/electron/src/renderer/src/components/ChatSessionList.tsx` | New sidebar component for session list with CRUD |
| `apps/electron/src/renderer/src/components/Chat.tsx` | Added `activeSessionId` prop, reset on session change, disabled input when no session |
| `apps/electron/src/renderer/src/App.tsx` | Added session state, IPC listener, session callbacks, sidebar layout integration |

## Key Implementation Details

### Storage Format

Each app now has a `.chat-sessions.json` manifest and session-scoped subdirectories under `.chat-history/`:

```
~/.keylimepi/apps/{app-id}/
├── .chat-sessions.json              ← Session manifest
├── .chat-history/
│   ├── {session-id-1}/              ← Messages for session 1
│   │   ├── 2024-01-15T10-30-00-000Z_abc123.json
│   │   └── 2024-01-15T10-30-05-500Z_def456.json
│   └── {session-id-2}/              ← Messages for session 2
│       └── 2024-01-16T09-00-00-000Z_ghi789.json
└── [app files...]
```

### Migration

On first load of an app with the old flat `.chat-history/` format (no `.chat-sessions.json`):

1. Detects `.json` files directly in `.chat-history/` (not in subdirectories)
2. Creates a `default/` subdirectory
3. Moves all existing message files into `.chat-history/default/`
4. Writes a manifest with a single "Chat" session pointing to the `default` directory
5. Proceeds normally -- zero data loss, fully automatic

### Session ID Generation

Uses `crypto.randomUUID()` from Node.js built-in (no additional dependency). IDs are formatted as `sess_` followed by 10 hex characters from the UUID, e.g., `sess_a1b2c3d4e5`.

### Auto-Create Default Session

When an app is selected that has zero sessions (fresh app or empty manifest), the `apps:set-active` IPC handler automatically creates a session titled "Chat". Users never see an empty state requiring manual session creation.

### Independent Conversation Context

Each session maintains its own Claude SDK `conversationHistory`. Switching sessions:

1. Saves current session state via manifest
2. Loads the target session's persisted messages
3. Rebuilds `conversationHistory` from text blocks
4. Emits `chat:history-loaded` and `chat:session-changed` to update the UI

### IPC Event Flow

- `sessions:list-updated` -- sent to renderer when the session list changes (app selected, session created/deleted)
- `chat:session-changed` -- sent to renderer when the active session ID changes
- `chat:history-loaded` -- sent to renderer with messages for the newly active session

### UI: ChatSessionList Sidebar

- 224px wide (`w-56`), placed to the left of the Chat panel
- Sessions sorted by `updatedAt` (most recent first)
- Active session highlighted with `bg-neutral-800`
- Hover reveals rename (pencil) and delete (x) buttons
- Inline text input for rename with Enter/Escape/blur handling
- "+ New" button in the header creates a session and switches to it

## Testing Checklist

- [x] Types compile without errors (`bun run typecheck:all`)
- [x] No linter errors
- [ ] Legacy flat `.chat-history/` migrates to session-based structure
- [ ] Existing messages are preserved during migration
- [ ] New apps get a default session automatically
- [ ] Sessions can be created, renamed, and deleted
- [ ] Switching sessions loads correct history and rebuilds Claude context
- [ ] Messages are saved to the correct session directory
- [ ] Deleting the active session activates the next most recent
- [ ] Chat input is disabled when no session is active
- [ ] Session list updates in real-time (create, delete, rename)
- [ ] Clear history only affects the current session
- [ ] App switching resets session state and loads new app's sessions

## Potential Future Improvements

1. **Auto-title sessions**: Use Claude to generate a title from the first message exchange (e.g., "Build the homepage" becomes the session title)
2. **Session search**: Search across sessions by message content
3. **Session limits**: Cap sessions per app (e.g., 50) to prevent excessive filesystem usage
4. **Collapsible sidebar**: Add a toggle to collapse/expand the 224px session sidebar
5. **Manifest corruption recovery**: Reconstruct manifest by scanning `.chat-history/` subdirectories if `.chat-sessions.json` is corrupted
6. **Drag-to-reorder**: Allow manual ordering of sessions instead of only by `updatedAt`
