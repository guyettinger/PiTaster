# Session 12 Notes: Add Source via UI

## Implementation Summary

Session 12 adds full CRUD for MCP source configurations directly from the Sources panel UI. Previously, sources could only be added by hand-editing JSON files in `~/.pitaster/sources/`. The backend APIs (`saveSource`, `deleteSource`) were built in Session 4 but never wired to the renderer. This session builds the missing UI components and connects them to the existing infrastructure.

## Files Changed

| File | Changes |
|------|---------|
| `apps/electron/src/renderer/src/components/AddSourceForm.tsx` | **New** — Reusable form component for adding/editing MCP sources |
| `apps/electron/src/renderer/src/components/SourcesPanel.tsx` | **Modified** — Integrated add, edit, delete UI and updated empty state |

**No changes needed** in:
- `packages/core/` (types already complete)
- `packages/shared/` (SourceManager already has `saveSource`/`deleteSource`)
- `apps/electron/src/main/ipc.ts` (IPC handlers already exist)
- `apps/electron/src/preload/` (preload APIs already exposed)
- `apps/electron/src/renderer/src/types/electron.d.ts` (types already declared)

## Key Implementation Details

### AddSourceForm Component

- Reusable for both add and edit modes via an optional `initialData` prop
- Fields: name (text), command (text), args (text), env (collapsible textarea with `KEY=VALUE` per line)
- Client-side validation: name and command are required; inline error displayed
- `submitLabel` prop allows customizing the button text (defaults to "Add Source" or "Save Changes" in edit mode)
- Exported helpers used by SourcesPanel: `generateId()`, `parseEnvLines()`, `validate()`

### Add Source Flow

1. User clicks "+" button in the SourcesPanel header
2. `AddSourceForm` renders inline between header and source list
3. On submit, `handleAddSource` generates a slug ID from the name
4. ID collision check: loads existing configs and appends a numeric suffix (`-2`, `-3`, etc.) if the ID is taken
5. Builds a full `McpSourceConfig` object and calls `window.electronAPI.saveSource(config)`
6. Closes form, refreshes list, then auto-connects (non-fatal if connect fails)

### Edit Source Flow

1. User clicks "Edit" on a source card
2. The card is replaced with a pre-filled `AddSourceForm` (args array joined with spaces, env record converted to `KEY=VALUE` lines)
3. On submit, `handleEditSource` disconnects the source if connected, saves the updated config (preserving original `id` and `createdAt`), then refreshes

### Delete Source Flow

1. User clicks "Delete" on a source card — button changes to "Confirm?"
2. If user clicks "Confirm?" within 3 seconds, `handleDelete` calls `window.electronAPI.deleteSource(id)` and refreshes
3. If 3 seconds elapse without confirmation, the button resets to "Delete"
4. The `deleteSource` backend automatically disconnects the source before removing the JSON file

### Empty State

- Replaced the old "Add MCP servers in ~/.pitaster/sources/" text with a prominent "+ Add MCP Source" button
- Clicking it opens the add form directly
- Helper text updated to "Connect MCP servers to extend agent capabilities"

### Type Handling

The `SourceConfig` base type in the preload/renderer does not include MCP-specific fields (`command`, `args`, `env`). The `SourceConfig` interface in `SourcesPanel.tsx` was extended with optional `command?`, `args?`, and `env?` fields to support reading these values back for the edit form. TypeScript structural typing allows passing objects with extra properties through `saveSource()`, and the IPC handler passes them through to `SourceManager.saveSource()` which writes the full object to disk.

## Testing Checklist

- [x] Types compile without errors (`bun run typecheck:all`)
- [x] No linter errors
- [ ] "+" button appears in SourcesPanel header
- [ ] AddSourceForm renders with name, command, args, and env fields
- [ ] Environment variables section is collapsible
- [ ] Form validates required fields (name, command)
- [ ] `saveSource` preload API is called with correct config shape
- [ ] Source auto-connects after save (with loading state)
- [ ] New source appears in list after save
- [ ] Empty state shows "+ Add MCP Source" button
- [ ] Delete button on each source with two-click confirmation
- [ ] `deleteSource` preload API is called; source removed from list
- [ ] Edit button pre-fills form with existing config
- [ ] Edit disconnects, saves, and refreshes
- [ ] ID collision produces unique IDs (e.g., `my-source`, `my-source-2`)
- [ ] Cancel closes form without side effects

## Potential Future Improvements

1. **SSE/Streamable HTTP transport** — Support MCP servers over HTTP in addition to stdio
2. **Source import/export** — Import sources from a JSON file or share configs
3. **Source templates** — Pre-configured popular MCP servers (filesystem, GitHub, etc.) as one-click installs
4. **Source health monitoring** — Periodic ping/reconnect for connected sources
5. **Bulk operations** — Connect all / disconnect all buttons
6. **API and Filesystem source forms** — Build UI forms for the `api` and `filesystem` source types
