# Session 13.3: Agent Integration and Polish

## Overview

This sub-session makes the agent aware of element context, allowing it to interpret element screenshots and DOM info to make targeted file modifications. Also adds polish like keyboard shortcuts and visual improvements.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: Session 13.2 complete (Context Injection)
**Deliverable**: Agent responds to element context with precise code changes

## Objectives

1. Convert element context to Claude API messages
2. Update agent to include element blocks in requests
3. Add element context awareness to system prompt
4. Polish UI with keyboard shortcuts and visual feedback
5. Add multi-select support (optional)

---

## Task 1: Element Context Converter

Create a utility to convert element context to Claude API message format.

### apps/electron/src/main/agent-utils.ts (new)

```typescript
/**
 * Utilities for converting app-specific types to Claude API format.
 */

import type { ElementContext } from '@anyapp/core/messages'

/**
 * Claude API message content block.
 */
interface ClaudeContentBlock {
  /** Content type. */
  type: 'text' | 'image'
  /** Text content (for type='text'). */
  text?: string
  /** Image source (for type='image'). */
  source?: {
    type: 'base64'
    media_type: 'image/png'
    data: string
  }
}

/**
 * Convert element context to Claude message format with text and image.
 * @param context - The element context to convert
 * @returns Array of Claude API content blocks
 */
export function convertElementContextToContent(
  context: ElementContext
): ClaudeContentBlock[] {
  const { element, screenshot } = context
  const content: ClaudeContentBlock[] = []

  // Text description
  let prompt = `[UI Element Context]\n`
  prompt += `Tag: <${element.tag}>\n`
  if (element.id) prompt += `ID: #${element.id}\n`
  if (element.classes.length > 0) {
    prompt += `Classes: ${element.classes.join(' ')}\n`
  }
  if (element.text) {
    prompt += `Text: "${element.text}"\n`
  }
  prompt += `CSS Selector: ${element.selector}\n`
  prompt += `XPath: ${element.xpath}\n`
  prompt += `Bounds: ${element.bounds.width}×${element.bounds.height}px at (${element.bounds.x}, ${element.bounds.y})\n`
  prompt += `\nYou can use the selector to locate this element in the source files.`

  content.push({
    type: 'text',
    text: prompt
  })

  // Screenshot
  if (screenshot) {
    const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '')
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: base64Data
      }
    })
  }

  return content
}
```

---

## Task 2: Update Agent to Process Element Blocks

Modify the agent to recognize and convert element blocks.

### apps/electron/src/main/agent.ts

Add import:

```typescript
import { convertElementContextToContent } from './agent-utils'
```

Update the message conversion logic in `sendMessage` function:

```typescript
// Find the section where messages are converted to Claude API format
// Update the block processing to handle element blocks:

for (const block of message.blocks) {
  if (block.type === 'text') {
    content.push({
      type: 'text',
      text: block.content
    })
  } else if (block.type === 'element' && block.elementContext) {
    // Convert element context to text + image
    const elementContent = convertElementContextToContent(block.elementContext)
    content.push(...elementContent)
  }
  // ... handle other block types
}
```

---

## Task 3: Update System Prompt

Add element context awareness to the agent's system prompt.

### apps/electron/src/main/agent.ts

Update the system prompt (find the system message construction):

```typescript
const systemPrompt = `You are an AI coding assistant for anyapp...

[Existing system prompt content]

## Element Context

When you receive a message with [UI Element Context], the user has selected a specific element from the preview panel. You'll receive:
- A screenshot showing the visual appearance
- DOM information (tag, classes, ID, text)
- CSS selector and XPath for locating the element in code

When responding to element context:
1. Use the selector to search for the element in the relevant component files
2. Consider the visual appearance and DOM structure when making changes
3. Make targeted changes to ONLY the selected element when possible
4. If the element is part of a reusable component, clarify with the user whether to change all instances or just this one
5. After making changes, explain what you modified and why

Example workflow:
- User selects a button in the preview
- You search for the button using the provided selector
- You find it in src/components/Header.tsx
- You make the requested change (e.g., color, text, size)
- You confirm the change and ask if the user wants to preview it
`
```

---

## Task 4: Keyboard Shortcuts

Add keyboard shortcuts for inspector mode.

### apps/electron/src/renderer/src/components/PreviewPanel.tsx

Update the keyboard handler:

```typescript
/**
 * Keyboard shortcuts for inspector.
 */
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // ESC exits inspect mode
    if (e.key === 'Escape' && isInspecting) {
      toggleInspector()
    }

    // Cmd/Ctrl+Shift+I toggles inspect mode
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
      e.preventDefault()
      toggleInspector()
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [isInspecting, toggleInspector])
```

Update button title to show shortcut:

```tsx
<button
  onClick={toggleInspector}
  className={/* ... */}
  title={isInspecting
    ? 'Exit inspect mode (ESC)'
    : 'Inspect elements (⌘⇧I)'
  }
>
  {isInspecting ? '✓ Inspecting' : '🔍 Inspect'}
</button>
```

---

## Task 5: Visual Feedback Improvements

Add visual indicators when inspector is active.

### packages/shared/src/inspector/overlay.ts

Add a banner to show inspector is active:

```typescript
let bannerOverlay: HTMLDivElement | null = null

/**
 * Create a banner showing inspector is active.
 */
function createBanner(): HTMLDivElement {
  const banner = document.createElement('div')
  banner.id = 'anyapp-inspector-banner'
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(59, 130, 246, 0.95);
    color: white;
    padding: 8px 16px;
    border-radius: 0 0 8px 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 500;
    z-index: 999998;
    pointer-events: none;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `
  banner.textContent = '🔍 Inspector Active — Click any element to select • ESC to exit'
  document.body.appendChild(banner)
  return banner
}

/**
 * Update activate() to show banner.
 */
export function activate(): void {
  if (isActive) return
  isActive = true

  // Create overlays
  if (!highlightOverlay) {
    highlightOverlay = createOverlay()
  }
  if (!bannerOverlay) {
    bannerOverlay = createBanner()
  }

  // Show banner
  if (bannerOverlay) {
    bannerOverlay.style.display = 'block'
  }

  // ... rest of activate logic
}

/**
 * Update deactivate() to hide banner.
 */
export function deactivate(): void {
  if (!isActive) return
  isActive = false

  // ... existing deactivate logic

  // Hide banner
  if (bannerOverlay) {
    bannerOverlay.style.display = 'none'
  }
}
```

---

## Task 6: Element Context Prompt Helper

Add a text input to let users provide context with the element.

### apps/electron/src/renderer/src/components/Chat.tsx

Update the element context handler to prompt for additional context:

```typescript
/**
 * Listen for element context events.
 */
useEffect(() => {
  const unsubscribe = window.electronAPI.onElementContextAdded((context) => {
    // Add a new user message with element context
    const message = {
      id: nanoid(),
      role: 'user' as const,
      blocks: [
        {
          type: 'element' as const,
          content: '',
          elementContext: context,
          timestamp: new Date().toISOString()
        }
      ],
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, message])

    // Focus the input and add a suggestion
    // (Implementation depends on your chat input component structure)
  })

  return unsubscribe
}, [])
```

### apps/electron/src/renderer/src/components/ElementContextBubble.tsx

Add a hint at the bottom of the bubble:

```tsx
{/* At the end of the component */}
<div className="border-t border-blue-500/30 bg-neutral-900/50 px-3 py-2">
  <p className="text-xs text-neutral-500">
    💡 Type your request below to modify this element
  </p>
</div>
```

---

## Task 7: Multi-Select Support (Optional)

Add ability to select multiple elements by holding Shift.

### packages/shared/src/inspector/overlay.ts

Add state for multiple selections:

```typescript
let selectedElements: Element[] = []

/**
 * Update handleClick to support multi-select.
 */
function handleClick(e: MouseEvent): void {
  if (!isActive) return

  e.preventDefault()
  e.stopPropagation()

  const element = document.elementFromPoint(e.clientX, e.clientY)
  if (element && element !== highlightOverlay) {
    const info = extractElementInfo(element)

    // Multi-select with Shift key
    if (e.shiftKey) {
      selectedElements.push(element)

      // Send with count
      window.parent.postMessage({
        type: 'anyapp:element-selected',
        data: info,
        isMultiSelect: true,
        selectionCount: selectedElements.length
      }, '*')

      // Flash selection
      if (highlightOverlay) {
        highlightOverlay.style.borderColor = '#10b981'
        setTimeout(() => {
          if (highlightOverlay) {
            highlightOverlay.style.borderColor = '#3b82f6'
          }
        }, 200)
      }
    } else {
      // Single select
      selectedElements = [element]
      selectedElement = element

      window.parent.postMessage({
        type: 'anyapp:element-selected',
        data: info,
        isMultiSelect: false
      }, '*')

      // Flash and exit
      if (highlightOverlay) {
        highlightOverlay.style.borderColor = '#10b981'
        highlightOverlay.style.backgroundColor = 'rgba(16, 185, 129, 0.2)'
        setTimeout(() => {
          if (highlightOverlay) {
            highlightOverlay.style.borderColor = '#3b82f6'
            highlightOverlay.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'
          }
        }, 300)
      }
    }
  }
}
```

Update banner to show multi-select hint:

```typescript
banner.textContent = '🔍 Inspector Active — Click to select • Shift+Click for multiple • ESC to exit'
```

---

## Verification Checklist

- [ ] Agent receives element context in API calls
- [ ] Element screenshots appear in Claude API messages
- [ ] Agent system prompt includes element context instructions
- [ ] Agent can locate elements using provided selectors
- [ ] Agent makes targeted changes to selected elements
- [ ] Cmd/Ctrl+Shift+I toggles inspector mode
- [ ] ESC exits inspector mode
- [ ] Inspector banner appears at top when active
- [ ] Element context bubble shows prompt hint
- [ ] Shift+Click enables multi-select (optional)
- [ ] Multi-select shows count in banner (optional)
- [ ] `bun run typecheck:all` passes

---

## Testing

1. Start dev server: `bun run dev`
2. Create and run a React app
3. Click "🔍 Inspect" or press Cmd+Shift+I
4. See banner at top: "🔍 Inspector Active..."
5. Click a button element
6. Element context appears in chat with screenshot
7. Type: "Make this button larger and change it to green"
8. Agent should:
   - Search for the button using the selector
   - Find the relevant component file
   - Modify the button styles
   - Explain what was changed
9. Verify the changes in preview panel
10. Test keyboard shortcuts (Cmd+Shift+I, ESC)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/electron/src/main/agent-utils.ts` | **New** — Element context conversion utilities |
| `apps/electron/src/main/agent.ts` | **Modified** — Process element blocks, update system prompt |
| `apps/electron/src/renderer/src/components/PreviewPanel.tsx` | **Modified** — Add keyboard shortcuts |
| `packages/shared/src/inspector/overlay.ts` | **Modified** — Add banner, multi-select support |
| `apps/electron/src/renderer/src/components/ElementContextBubble.tsx` | **Modified** — Add prompt hint |
| `apps/electron/src/renderer/src/components/Chat.tsx` | **Modified** — Update element context handler |

---

## Commit Checkpoint

```bash
bun run build
bun run typecheck:all

git add -A
git commit -m "feat(inspector): agent integration and polish (Session 13.3)

- Agent receives element context in API calls
- Element context converter with text + image
- Updated system prompt for element awareness
- Keyboard shortcuts (Cmd+Shift+I, ESC)
- Inspector active banner in webview
- Element context prompt hint in chat
- Multi-select support with Shift+Click (optional)
- Agent makes targeted changes using selectors"
```

---

## Final Session Commit

After completing all 3 sub-sessions, create a final commit:

```bash
git add -A
git commit -m "feat: complete addressable UI element inspection (Session 13)

Session 13 complete:
- Element inspector overlay with hover highlights (13.1)
- Click-to-select elements in preview webview (13.1)
- DOM info extraction (tag, classes, selectors, XPath) (13.1)
- Screenshot capture with sharp (13.2)
- Element context message type in chat (13.2)
- ElementContextBubble component for rich display (13.2)
- Agent receives element context with screenshots (13.3)
- Element-aware system prompt (13.3)
- Keyboard shortcuts (Cmd+Shift+I, ESC) (13.3)
- Inspector active banner (13.3)
- Multi-select support (13.3)

Enables users to point at UI elements and request targeted modifications."
```

---

## Future Enhancements (Out of Scope)

1. **Element history** — Save previously selected elements for reuse
2. **Computed styles** — Include full computed styles in context
3. **Accessibility info** — Capture ARIA attributes, roles, labels
4. **Component detection** — Identify React component names from dev tools
5. **Batch editing** — Select multiple elements, apply changes to all
6. **Element comparison** — Compare two elements side-by-side
7. **Live preview** — Show changes in preview as agent modifies files
8. **Undo/redo** — Revert element modifications
9. **Export selections** — Save element contexts for documentation
10. **Mobile breakpoints** — Switch preview to mobile viewport sizes

---

## Session Complete

All 3 sub-sessions of Session 13 are now complete. The addressable UI system allows users to:

✅ Click elements in the preview to select them
✅ See element info + screenshot in chat
✅ Ask the agent to modify specific elements
✅ Agent locates and modifies the correct code
✅ Use keyboard shortcuts for fast workflow

The agent now has visual and structural understanding of UI elements, enabling precise, targeted modifications.
