---
paths:
  - "apps/electron/src/renderer/**/*.tsx"
---

# React Patterns

The renderer is React 19 + Tailwind CSS v4, rendered inside Electron. There is
no router and no data-fetching library — all data crosses the context bridge as
`window.electronAPI` calls.

## Fundamentals

- Components and hooks must be pure functions
- Import from `'react'` directly (`import { useState } from 'react'`) — never UMD `React.` references
- Use `useCallback` for functions passed as props or into other hooks' dependencies
- Use `useMemo` for expensive computations, not for simple object creation
- Avoid premature optimization — memoize when profiling shows a benefit
- Exception: functions returned from custom hooks should generally be wrapped in `useCallback`
- Refs are escape hatches — use sparingly, prefer state

## Component Patterns

- **Named exports**, never default exports
- Props interfaces documented with TSDoc
- Relative imports for local modules (`./MessageBubble`, `../types/electron`)
- Tailwind utility classes directly in JSX

```tsx
import { useState, useCallback } from 'react'

/**
 * Props for the ChatInput component.
 */
interface ChatInputProps {
  /** Callback when message is sent. */
  onSend: (message: string) => void
  /** Whether input is disabled. */
  disabled?: boolean
}

/**
 * Chat input with send button.
 */
export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('')

  const handleSend = useCallback(() => {
    if (value.trim()) {
      onSend(value)
      setValue('')
    }
  }, [value, onSend])

  return (
    <div className={`flex gap-2 p-4 ${disabled ? 'opacity-50' : ''}`}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="flex-1 rounded border px-3 py-2"
      />
      <button onClick={handleSend} disabled={disabled}>Send</button>
    </div>
  )
}
```

## Tailwind

- Utility-first: classes go directly in the component
- Extract repeated patterns into reusable components, not custom CSS classes
- Map props to complete, static class names — never build class strings dynamically
  (`bg-${color}-500` does not survive Tailwind's scan)
- Reserve inline `style` for genuinely dynamic values (computed positions, sizes)

### Spacing

The scale is Tailwind's 4px grid, documented in full at the top of
`styles/globals.css`. Which gutter to reach for depends on the environment:

| Environment | Gutter | Where |
|-------------|--------|-------|
| Chrome | `px-3` | Title bar, and docked panels throughout — header and body |
| Columns | `px-2` | Nav rail, app context column. Rows add their own `px-2` |
| Pages | `px-6` | Apps, Skills, Help, Settings, the transcript and composer |

Page headers are `py-4`, page bodies `py-5`. A page header's own row takes the
body's `max-w-*`, so a right-aligned action ends where the content it acts on
ends instead of floating out at the page gutter. A scrolling list inside a
docked panel goes full-bleed and carries `px-3` on its rows, so they sit on the
panel's line. `py-1.5` (6px) is the dense row
and the only half-step in the system — `p-2.5`, `py-3.5` and friends are not
steps, and reintroducing one is what makes the shell drift.

Buttons come in two sizes: `px-3 py-1.5` inside a bar, `px-4 py-2` for a page
action. Icon-only buttons are `p-1.5`, or `p-1` when they sit inside a 13px
row. Adjacent buttons always share a size. Every button needs a hit area — a
bare text label with no padding is not a target.

**A stack owns its own gaps.** Never put `my-*` on a component that renders
into a `space-y-*` parent. Tailwind v4 emits space-y inside `:where()`, which
has zero specificity, so the child's margin silently *overrides* the parent's
rhythm instead of adding to it — and the parent looks like it is in control
when it is not. Gaps belong to the list; padding belongs to the item.

Blocks stacked in the same column share one horizontal inset, so their content
reads as one column. In the chat transcript that is `px-4` for message bubbles,
tool bubbles, approval records and the approval gate alike; vertical padding
still tracks each one's density.

Chrome is drawn from `components/icons`, never from an emoji. The only emoji in
the UI are the app-listing template glyphs, which are content.

The title bar's left padding is `pl-titlebar`, a measured token that clears the
macOS traffic lights. Don't hardcode it — the arithmetic depends on
`trafficLightPosition` in `main/index.ts`.

## Naming

- **Components**: PascalCase (`MessageBubble`)
- **Files**: PascalCase, matching the exported component (`MessageBubble.tsx`)
- **Hooks**: `use` prefix, camelCase (`useAgentStream`)
- **Constants**: `SCREAMING_SNAKE_CASE` (`MAX_MESSAGE_LENGTH`)

## Import Organization

```tsx
// 1. React
import { useState, useEffect, useCallback } from 'react'

// 2. Third-party
import { nanoid } from 'nanoid'

// 3. Local components
import { MessageBubble } from './MessageBubble'

// 4. Types — IPC types from ../types/electron, domain types from @anyapp/core
import type { PermissionMode, StreamChunk } from '../types/electron'
import type { SerializedContentBlock } from '@anyapp/core'
```

## Electron IPC Integration

Data arrives by subscribing to streamed events, not by fetching:

```tsx
export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    window.electronAPI.onAgentStream((chunk) => {
      if (chunk.type === 'text') {
        setMessages(prev => appendToLast(prev, chunk.text))
      } else if (chunk.type === 'complete') {
        setIsStreaming(false)
      }
    })
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    setIsStreaming(true)
    await window.electronAPI.sendMessage(content)
  }, [])

  return (
    <div className="flex min-h-svh flex-col">
      <MessageList messages={messages} />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  )
}
```

Every bridge function must be declared in
`apps/electron/src/renderer/src/types/electron.d.ts`:

```typescript
interface ElectronAPI {
  sendMessage: (message: string) => Promise<void>
  onAgentStream: (callback: (chunk: StreamChunk) => void) => void
  getPermissionMode: () => Promise<PermissionMode>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
```

## Anti-Patterns

- **Don't mutate state directly** — always use setters or return new objects
- **Don't construct Tailwind classes dynamically** — use complete static class names
- **Don't use `React.FC`** — use function declarations with typed props
- **Don't use default exports**
- **Don't scatter `window.electronAPI` calls through `useEffect` bodies** — extract them into a named custom hook so subscription and cleanup live in one place
