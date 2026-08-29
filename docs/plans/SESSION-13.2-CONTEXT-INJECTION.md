# Session 13.2: Element Context Injection

## Overview

This sub-session adds screenshot capture for selected elements and injects them into the chat as rich context messages. Users see element info + screenshot in the chat, ready for the agent to process.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: Session 13.1 complete (Inspector Overlay)
**Deliverable**: Element context messages with screenshots appear in chat

## Objectives

1. Add element context message type to core types
2. Implement screenshot capture service
3. Create IPC for element capture and context injection
4. Add ElementContextBubble component for chat display
5. Wire element selection to chat context

---

## Task 1: Element Context Message Type

Extend the message types to support element context.

### packages/core/src/messages.ts

Add after existing types:

```typescript
/**
 * Element context attached to a message.
 */
export interface ElementContext {
  /** Element info from DOM. */
  element: {
    tag: string
    text: string
    classes: string[]
    id?: string
    selector: string
    xpath: string
    bounds: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  /** Screenshot of the element (base64 data URL). */
  screenshot?: string
  /** Timestamp when element was captured. */
  capturedAt: string
}

/**
 * Update ContentBlock to support element context.
 */
export interface ContentBlock {
  type: ContentBlockType | 'element'
  content: string
  tool?: string
  input?: Record<string, unknown>
  timestamp?: string
  status?: 'pending' | 'running' | 'complete' | 'approved' | 'denied'
  /** Element context for 'element' type blocks. */
  elementContext?: ElementContext
}
```

Update the ContentBlockType:

```typescript
export type ContentBlockType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'tool_approved'
  | 'tool_denied'
  | 'element'  // New
```

---

## Task 2: Screenshot Capture Service

Create a service to capture element screenshots.

### apps/electron/src/main/screenshot.ts (new)

```typescript
/**
 * Screenshot service for capturing element regions.
 */

import { screen, desktopCapturer, BrowserWindow } from 'electron'
import sharp from 'sharp'

/**
 * Element info from inspector overlay.
 */
export interface ElementInfo {
  tag: string
  text: string
  classes: string[]
  id?: string
  dataAttributes: Record<string, string>
  styles: {
    position: string
    display: string
    width: string
    height: string
    backgroundColor?: string
    color?: string
  }
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  xpath: string
  selector: string
}

/**
 * Capture a region of the screen.
 */
export async function captureRegion(
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number }
): Promise<string> {
  try {
    // Get window position
    const [winX, winY] = window.getPosition()
    const windowBounds = window.getBounds()

    // Capture the entire window
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: windowBounds.width * 2,  // 2x for retina
        height: windowBounds.height * 2
      }
    })

    // Find the window source
    const windowSource = sources.find(source => source.id.includes(window.id.toString()))
    if (!windowSource) {
      throw new Error('Window source not found')
    }

    const screenshot = windowSource.thumbnail

    // Convert to buffer
    const buffer = screenshot.toPNG()

    // Account for device pixel ratio
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1

    // Crop to element region
    const cropped = await sharp(buffer)
      .extract({
        left: Math.max(0, Math.floor(bounds.x * scaleFactor)),
        top: Math.max(0, Math.floor(bounds.y * scaleFactor)),
        width: Math.max(1, Math.floor(bounds.width * scaleFactor)),
        height: Math.max(1, Math.floor(bounds.height * scaleFactor))
      })
      .resize({
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
        fit: 'contain'
      })
      .png()
      .toBuffer()

    // Return as base64 data URL
    return `data:image/png;base64,${cropped.toString('base64')}`
  } catch (err) {
    console.error('Screenshot capture failed:', err)
    throw err
  }
}

/**
 * Capture an element with screenshot.
 */
export async function captureElement(
  window: BrowserWindow,
  elementInfo: ElementInfo
): Promise<{
  element: ElementContext['element']
  screenshot: string
  capturedAt: string
}> {
  const screenshot = await captureRegion(window, elementInfo.bounds)

  return {
    element: {
      tag: elementInfo.tag,
      text: elementInfo.text,
      classes: elementInfo.classes,
      id: elementInfo.id,
      selector: elementInfo.selector,
      xpath: elementInfo.xpath,
      bounds: elementInfo.bounds
    },
    screenshot,
    capturedAt: new Date().toISOString()
  }
}
```

---

## Task 3: Screenshot IPC Handlers

Add IPC handlers for element capture and context injection.

### apps/electron/src/main/ipc.ts

Add imports:

```typescript
import { captureElement, type ElementInfo } from './screenshot'
```

Add handlers:

```typescript
/**
 * Capture element screenshot.
 */
ipcMain.handle(
  'inspector:capture-element',
  async (event, elementInfo: ElementInfo) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('Window not found')

      const elementContext = await captureElement(window, elementInfo)
      return elementContext
    } catch (err) {
      console.error('Element capture failed:', err)
      throw err
    }
  }
)

/**
 * Add element context to the current chat.
 */
ipcMain.handle('chat:add-element-context', async (event, context: ElementContext) => {
  // Notify all renderer windows to inject element context
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('chat:element-context-added', context)
  })
})
```

### apps/electron/src/preload/index.ts

Add APIs:

```typescript
import type { ElementInfo } from '../main/screenshot'
import type { ElementContext } from '@anyapp/core/messages'

{
  // ... existing APIs
  captureElement: (elementInfo: ElementInfo) =>
    ipcRenderer.invoke('inspector:capture-element', elementInfo),

  addElementContext: (context: ElementContext) =>
    ipcRenderer.invoke('chat:add-element-context', context),

  onElementContextAdded: (callback: (context: ElementContext) => void) => {
    const handler = (_event: IpcRendererEvent, context: ElementContext) => callback(context)
    ipcRenderer.on('chat:element-context-added', handler)
    return () => ipcRenderer.removeListener('chat:element-context-added', handler)
  }
}
```

### apps/electron/src/renderer/src/types/electron.d.ts

Add types:

```typescript
import type { ElementContext } from '@anyapp/core/messages'

interface ElectronAPI {
  // ... existing types
  captureElement: (elementInfo: ElementInfo) => Promise<ElementContext>
  addElementContext: (context: ElementContext) => Promise<void>
  onElementContextAdded: (callback: (context: ElementContext) => void) => () => void
}

/**
 * Element info from inspector overlay.
 */
interface ElementInfo {
  /** Tag name (e.g., 'button', 'div'). */
  tag: string
  /** Element text content (trimmed). */
  text: string
  /** CSS classes. */
  classes: string[]
  /** ID attribute. */
  id?: string
  /** Data attributes. */
  dataAttributes: Record<string, string>
  /** Computed styles (selected properties). */
  styles: {
    position: string
    display: string
    width: string
    height: string
    backgroundColor?: string
    color?: string
  }
  /** Bounding rect relative to viewport. */
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  /** XPath selector for the element. */
  xpath: string
  /** CSS selector (best attempt). */
  selector: string
}
```

---

## Task 4: ElementContextBubble Component

Create a component to display element context in chat.

### apps/electron/src/renderer/src/components/ElementContextBubble.tsx (new)

```tsx
/**
 * Display an element context block in chat.
 */

import type { ElementContext } from '@anyapp/core/messages'

/**
 * Props for the ElementContextBubble component.
 */
interface ElementContextBubbleProps {
  /** The element context to display. */
  context: ElementContext
}

/**
 * Displays an element context block with screenshot and DOM info.
 */
export function ElementContextBubble({ context }: ElementContextBubbleProps) {
  const { element, screenshot } = context

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-blue-500/30 bg-blue-950/20">
      {/* Screenshot */}
      {screenshot && (
        <div className="border-b border-blue-500/30 bg-neutral-900/50 p-2">
          <img
            src={screenshot}
            alt="Selected element"
            className="max-h-48 rounded border border-neutral-700"
          />
        </div>
      )}

      {/* Element info */}
      <div className="space-y-1 p-3 text-xs">
        <div>
          <span className="text-neutral-500">Tag:</span>{' '}
          <code className="text-blue-400">{element.tag}</code>
        </div>

        {element.id && (
          <div>
            <span className="text-neutral-500">ID:</span>{' '}
            <code className="text-blue-400">#{element.id}</code>
          </div>
        )}

        {element.classes.length > 0 && (
          <div>
            <span className="text-neutral-500">Classes:</span>{' '}
            <code className="text-neutral-400">{element.classes.join(' ')}</code>
          </div>
        )}

        {element.text && (
          <div>
            <span className="text-neutral-500">Text:</span>{' '}
            <span className="text-neutral-300">
              {element.text.length > 80
                ? element.text.slice(0, 80) + '...'
                : element.text
              }
            </span>
          </div>
        )}

        <details className="mt-2">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
            Selectors
          </summary>
          <div className="mt-1 space-y-1 pl-2">
            <div>
              <span className="text-neutral-600">CSS:</span>{' '}
              <code className="break-all text-xs text-neutral-400">{element.selector}</code>
            </div>
            <div>
              <span className="text-neutral-600">XPath:</span>{' '}
              <code className="break-all text-xs text-neutral-400">{element.xpath}</code>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
```

---

## Task 5: Update Chat Component

Wire element context into the Chat component.

### apps/electron/src/renderer/src/components/Chat.tsx

Add import:

```typescript
import { ElementContextBubble } from './ElementContextBubble'
import { nanoid } from 'nanoid'
```

Add effect to listen for element context:

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
          type: 'text' as const,
          content: 'Please help me modify this element:',
          timestamp: new Date().toISOString()
        },
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
  })

  return unsubscribe
}, [])
```

Update content block rendering to handle element blocks:

```tsx
{/* In the block rendering section */}
{block.type === 'element' && block.elementContext && (
  <ElementContextBubble context={block.elementContext} />
)}
```

---

## Task 6: Wire PreviewPanel to Chat

Update PreviewPanel to capture and inject element context.

### apps/electron/src/renderer/src/components/PreviewPanel.tsx

Update the message handler:

```typescript
/**
 * Handle element selection messages from webview.
 */
useEffect(() => {
  const handleMessage = async (event: MessageEvent) => {
    if (event.data?.type === 'anyapp:element-selected') {
      const elementInfo = event.data.data

      try {
        // Capture screenshot
        const elementContext = await window.electronAPI.captureElement(elementInfo)

        // Inject into chat
        await window.electronAPI.addElementContext(elementContext)

        // Exit inspect mode
        setIsInspecting(false)
        if (webviewRef.current) {
          await webviewRef.current.executeJavaScript('window.__anyappInspector?.deactivate()')
        }
      } catch (err) {
        console.error('Failed to capture element:', err)
      }
    }
  }

  window.addEventListener('message', handleMessage)
  return () => window.removeEventListener('message', handleMessage)
}, [])
```

---

## Task 7: Add Sharp Dependency

Install sharp for image processing.

### apps/electron/package.json

```json
{
  "dependencies": {
    "sharp": "^0.33.0"
  }
}
```

Run:

```bash
cd apps/electron
bun install
```

---

## Verification Checklist

- [ ] Sharp installs successfully
- [ ] ElementContext type is defined in core/messages.ts
- [ ] Screenshot service compiles without errors
- [ ] IPC handlers for capture-element and add-element-context exist
- [ ] ElementContextBubble component renders correctly
- [ ] Selecting an element in preview captures screenshot
- [ ] Element context message appears in chat with screenshot
- [ ] Screenshot displays correctly (not distorted)
- [ ] Element info (tag, classes, text) displays correctly
- [ ] Selectors (CSS, XPath) are collapsible and correct
- [ ] Inspector exits after element selection
- [ ] `bun run typecheck:all` passes

---

## Testing

1. Start the dev server: `bun run dev`
2. Create and run a React app
3. Open preview panel
4. Click "🔍 Inspect"
5. Click any element (e.g., a button)
6. Check chat — should see a new message with:
   - Text: "Please help me modify this element:"
   - Element bubble with screenshot
   - Element info (tag, classes, text, selectors)
7. Screenshot should be crisp and correctly sized
8. Click details to expand selectors

---

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/messages.ts` | **Modified** — Add `ElementContext`, update `ContentBlock` |
| `apps/electron/src/main/screenshot.ts` | **New** — Screenshot capture service |
| `apps/electron/src/main/ipc.ts` | **Modified** — Add capture and context handlers |
| `apps/electron/src/preload/index.ts` | **Modified** — Add capture/context APIs |
| `apps/electron/src/renderer/src/types/electron.d.ts` | **Modified** — Type new APIs |
| `apps/electron/src/renderer/src/components/ElementContextBubble.tsx` | **New** — Element context display component |
| `apps/electron/src/renderer/src/components/Chat.tsx` | **Modified** — Handle element blocks, listen for context |
| `apps/electron/src/renderer/src/components/PreviewPanel.tsx` | **Modified** — Capture and inject on selection |
| `apps/electron/package.json` | **Modified** — Add sharp dependency |

---

## Commit Checkpoint

```bash
bun install
bun run build
bun run typecheck:all

git add -A
git commit -m "feat(inspector): element context injection (Session 13.2)

- ElementContext type for screenshots + DOM info
- Screenshot capture service with sharp
- Element capture IPC handler
- ElementContextBubble component for chat display
- Element context messages injected into chat
- Preview panel captures and injects on selection
- Support for element blocks in chat renderer
- Sharp dependency for image processing"
```

---

## Next Steps

Continue to [Session 13.3: Agent Integration](SESSION-13.3-AGENT-INTEGRATION.md) to make the agent aware of element context and able to respond with targeted changes.
