# Session 7 Notes: Chat UI Improvements

## Status

**Not Started**

## Completed

- [ ] Task 1: Create ToolBubble component
- [ ] Task 2: Create InlineApproval component
- [ ] Task 3: Create ApprovalRecord component
- [ ] Task 4: Create TextBubble component
- [ ] Task 5: Update MessageBubble component
- [ ] Task 6: Update Chat component
- [ ] Task 7: Update stream chunk handler in main process
- [ ] Task 8: Update Electron types
- [ ] Verification and testing
- [ ] `bun run typecheck:all` passes

## Files to Create

| File | Purpose |
|------|---------|
| `components/ToolBubble.tsx` | Inline tool usage display |
| `components/InlineApproval.tsx` | In-chat approval requests |
| `components/ApprovalRecord.tsx` | Past approval decision display |
| `components/TextBubble.tsx` | Text content rendering |

## Files to Modify

| File | Changes |
|------|---------|
| `components/MessageBubble.tsx` | Refactor to use new block-based architecture |
| `components/Chat.tsx` | Integrate inline approvals, block-based messages |
| `main/agent.ts` | Send richer tool input/output in stream chunks |
| `types/electron.d.ts` | Add input/output to StreamChunk type |

## Key Changes

### New Component: ToolBubble

Displays tool usage inline with:
- Tool icon and name
- Status indicator (running/complete/approved/denied)
- Summary line (command, file path, etc.)
- Expandable details for full input/output

### New Component: InlineApproval

Replaces modal `ToolApprovalDialog` with in-chat approval:
- Appears in message flow
- Shows tool summary
- Collapsible full input details
- Deny/Allow buttons

### New Component: ApprovalRecord

Compact record of past approval decisions:
- Shows approved/denied status
- Tool name and summary

### Updated MessageBubble

Block-based architecture:
- Supports multiple content blocks per message
- Block types: text, tool, approval
- Renders appropriate component per block type
- Maintains backward compatibility with legacy format

### Updated Chat

- Stores tool input data when tools start
- Records approval decisions as blocks
- Replaces modal with inline approval
- Manages block-based message streaming

### Updated Stream Chunks

Extended StreamChunk type:
```typescript
interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  text?: string
  tool?: string
  input?: Record<string, unknown>  // NEW
  output?: string                   // NEW
  error?: string
}
```

## Visual Comparison

### Before
```
┌─────────────────────────────────────┐
│ [run_command ✓] [read_file ✓] ...   │
│                                     │
│ Let me try to run the dev server    │
│ again:Let me check if we need...    │
│ (continuous text blob)              │
└─────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────┐
│ ⌘ Command                    ✓ Done │
│ npm run dev                         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Let me check if we need to update   │
│ the Tailwind configuration.         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ⚠️ Approval Required                │
│ Write to: tailwind.config.ts        │
│ [  Deny  ] [  Allow  ]              │
└─────────────────────────────────────┘
```

## Implementation Notes

(To be filled in during implementation)

## Issues Encountered

(To be filled in during implementation)

## Verification Checklist

- [ ] ToolBubble renders with correct status styling
- [ ] Tool input summary shows correctly
- [ ] Expandable details work for full input/output
- [ ] InlineApproval appears in chat flow (not as modal)
- [ ] ApprovalRecord shows after decisions
- [ ] TextBubble renders text with code blocks
- [ ] Messages correctly split into blocks
- [ ] Streaming updates appear in correct block
- [ ] Legacy message format still works
- [ ] Auto-scroll to bottom works
- [ ] `bun run typecheck:all` passes
