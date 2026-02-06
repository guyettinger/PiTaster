# Session 9 Notes: Chat History Persistence

## Implementation Summary

Session 9 adds persistent chat history for each sub-app, storing messages as individual JSON files that are automatically loaded when switching between apps.

## Files Created

| File | Purpose |
|------|---------|
| `packages/core/src/chat.ts` | Type definitions for persisted messages |
| `packages/shared/src/chat/manager.ts` | ChatHistoryManager class |
| `packages/shared/src/chat/index.ts` | Barrel export |

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/index.ts` | Export chat types |
| `packages/shared/src/index.ts` | Export ChatHistoryManager |
| `apps/electron/src/main/ipc.ts` | Added chat history IPC handlers, modified `apps:set-active` |
| `apps/electron/src/preload/index.ts` | Added chat history API methods |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Added type definitions |
| `apps/electron/src/renderer/src/components/Chat.tsx` | Integrated history loading/saving |

## Key Implementation Details

### Storage Format

Messages are stored as individual JSON files in each app's `.chat-history/` directory:

```
~/.anyapp/apps/{app-id}/.chat-history/
├── 2024-01-15T10-30-00-000Z_abc123.json
├── 2024-01-15T10-30-05-500Z_def456.json
└── 2024-01-15T10-31-00-000Z_ghi789.json
```

- Filenames use ISO timestamps with colons replaced by hyphens for filesystem compatibility
- Alphabetical sorting = chronological order
- Each file contains a single `PersistedMessage` JSON object

### Block Type Conversion

The UI uses `tool` property for tool blocks, while serialized format uses `name`:

```typescript
// UI ContentBlock (tool)
{ type: 'tool', tool: 'read_file', status: 'complete', ... }

// Serialized SerializedToolBlock
{ type: 'tool', name: 'read_file', status: 'complete', ... }
```

Conversion functions handle this mapping:
- `convertToUIBlocks()` - serialized → UI
- `convertToSerializedBlocks()` - UI → serialized

### Claude Context Rebuild

When switching apps, the `apps:set-active` handler:
1. Clears in-memory `conversationHistory`
2. Loads persisted messages from disk
3. Rebuilds `conversationHistory` from text content only (tools are transient)
4. Emits `chat:history-loaded` event to renderer

### Error Handling

All save operations use try/catch with silent failures:
- No active app selected → save silently skipped
- File system errors → logged but don't interrupt UX

### Race Condition Fix

The Chat component conditionally renders based on `mainPanel === 'chat'`. When an app is selected:
1. `setActiveApp(app.id)` emits `chat:history-loaded` event
2. `setMainPanel('chat')` happens after, causing Chat to mount

To handle this race condition, the Chat component:
1. Sets up the `onChatHistoryLoaded` listener for future switches
2. Immediately calls `loadChatHistory()` on mount to catch missed events

## Testing Checklist

- [x] Types compile without errors
- [ ] ChatHistoryManager correctly saves messages as individual files
- [ ] Files are named with timestamp and sorted chronologically
- [ ] Switching apps loads the correct history
- [ ] Messages persist across app restart
- [ ] Clear history removes all message files
- [ ] Claude SDK `conversationHistory` is rebuilt from persisted messages
- [ ] UI displays loaded history correctly

## Potential Future Improvements

1. **Message Pruning**: Add option to limit history size (e.g., keep last 100 messages)
2. **Pagination**: For very long conversations, load messages in chunks
3. **Search**: Add ability to search through chat history
4. **Export**: Allow exporting conversation history as markdown
