# Session 13.1: Element Inspector Overlay

## Overview

This sub-session creates the client-side element inspector overlay that injects into the preview webview. Users can hover over elements to highlight them and click to select, extracting DOM information.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: Session 8 complete (App Preview)
**Deliverable**: Working element inspector with hover highlights and click-to-select

## Objectives

1. Create the inspector overlay script with element highlighting
2. Add preview panel controls for inspector mode
3. Implement IPC for loading the inspector script
4. Wire up element selection message passing

---

## Task 1: Inspector Overlay Script

Create the client-side overlay that runs inside the preview webview.

### packages/shared/src/inspector/overlay.ts

```typescript
/**
 * Client-side overlay for element inspection in preview webview.
 * Injected via webview.executeJavaScript() from renderer.
 */

/**
 * Element information extracted from DOM.
 */
export interface ElementInfo {
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

/**
 * Generate a CSS selector for an element.
 */
function generateSelector(element: Element): string {
  // Prefer ID
  if (element.id) {
    return `#${element.id}`
  }

  // Build path from classes and tag
  const parts: string[] = []
  let current: Element | null = element

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase()
    if (current.className) {
      const classes = Array.from(current.classList).filter(c =>
        // Skip utility classes
        !c.startsWith('tw-') && !c.match(/^(p|m|text|bg|flex|grid)-/)
      )
      if (classes.length > 0) {
        selector += `.${classes.slice(0, 2).join('.')}`
      }
    }
    parts.unshift(selector)
    current = current.parentElement
    if (parts.length > 4) break // Limit depth
  }

  return parts.join(' > ')
}

/**
 * Generate an XPath for an element.
 */
function generateXPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element

  while (current && current !== document.body) {
    let index = 0
    let sibling = current.previousElementSibling
    while (sibling) {
      if (sibling.tagName === current.tagName) index++
      sibling = sibling.previousElementSibling
    }
    const tagName = current.tagName.toLowerCase()
    const part = index > 0 ? `${tagName}[${index + 1}]` : tagName
    parts.unshift(part)
    current = current.parentElement
  }

  return '//' + parts.join('/')
}

/**
 * Extract element information.
 */
function extractElementInfo(element: Element): ElementInfo {
  const rect = element.getBoundingClientRect()
  const computed = window.getComputedStyle(element)

  // Extract data attributes
  const dataAttributes: Record<string, string> = {}
  Array.from(element.attributes).forEach(attr => {
    if (attr.name.startsWith('data-')) {
      dataAttributes[attr.name] = attr.value
    }
  })

  return {
    tag: element.tagName.toLowerCase(),
    text: element.textContent?.trim().slice(0, 100) || '',
    classes: Array.from(element.classList),
    id: element.id || undefined,
    dataAttributes,
    styles: {
      position: computed.position,
      display: computed.display,
      width: computed.width,
      height: computed.height,
      backgroundColor: computed.backgroundColor,
      color: computed.color
    },
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    xpath: generateXPath(element),
    selector: generateSelector(element)
  }
}

/**
 * Global state for the inspector overlay.
 */
let isActive = false
let highlightOverlay: HTMLDivElement | null = null
let selectedElement: Element | null = null

/**
 * Create the highlight overlay element.
 */
function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.id = 'anyapp-inspector-highlight'
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    border: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.1);
    z-index: 999999;
    transition: all 0.1s ease;
  `
  document.body.appendChild(overlay)
  return overlay
}

/**
 * Update overlay position to highlight an element.
 */
function highlightElement(element: Element): void {
  if (!highlightOverlay) return
  const rect = element.getBoundingClientRect()
  highlightOverlay.style.left = `${rect.left}px`
  highlightOverlay.style.top = `${rect.top}px`
  highlightOverlay.style.width = `${rect.width}px`
  highlightOverlay.style.height = `${rect.height}px`
  highlightOverlay.style.display = 'block'
}

/**
 * Hide the overlay.
 */
function hideOverlay(): void {
  if (highlightOverlay) {
    highlightOverlay.style.display = 'none'
  }
}

/**
 * Handle mousemove to highlight elements under cursor.
 */
function handleMouseMove(e: MouseEvent): void {
  if (!isActive) return

  const element = document.elementFromPoint(e.clientX, e.clientY)
  if (element && element !== highlightOverlay) {
    highlightElement(element)
  }
}

/**
 * Handle click to select an element.
 */
function handleClick(e: MouseEvent): void {
  if (!isActive) return

  e.preventDefault()
  e.stopPropagation()

  const element = document.elementFromPoint(e.clientX, e.clientY)
  if (element && element !== highlightOverlay) {
    selectedElement = element
    const info = extractElementInfo(element)

    // Send to parent via postMessage
    window.parent.postMessage({
      type: 'anyapp:element-selected',
      data: info
    }, '*')

    // Flash selection
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

/**
 * Activate inspector mode.
 */
export function activate(): void {
  if (isActive) return
  isActive = true

  // Create overlay if needed
  if (!highlightOverlay) {
    highlightOverlay = createOverlay()
  }

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)

  // Change cursor
  document.body.style.cursor = 'crosshair'

  console.log('[anyapp] Inspector mode activated')
}

/**
 * Deactivate inspector mode.
 */
export function deactivate(): void {
  if (!isActive) return
  isActive = false

  // Remove listeners
  document.removeEventListener('mousemove', handleMouseMove, true)
  document.removeEventListener('click', handleClick, true)

  // Reset cursor
  document.body.style.cursor = ''

  // Hide overlay
  hideOverlay()

  console.log('[anyapp] Inspector mode deactivated')
}

/**
 * Check if inspector is active.
 */
export function isActiveMode(): boolean {
  return isActive
}

// Expose global API for injection via executeJavaScript
;(window as any).__anyappInspector = {
  activate,
  deactivate,
  isActive: isActiveMode
}
```

---

## Task 2: Build Configuration

Update the build to compile the inspector overlay as a standalone script.

### packages/shared/tsconfig.json

Ensure the inspector directory is included:

```json
{
  "include": ["src/**/*"],
  "compilerOptions": {
    "outDir": "dist"
  }
}
```

Build will output to `packages/shared/dist/inspector/overlay.js`.

---

## Task 3: Inspector Script IPC

Add IPC handlers to load the inspector script on demand.

### apps/electron/src/main/ipc.ts

Add handler after existing handlers:

```typescript
/**
 * Load the inspector overlay script as a string.
 */
ipcMain.handle('inspector:get-script', async () => {
  try {
    // Read the compiled inspector script
    const scriptPath = path.join(__dirname, '../../packages/shared/dist/inspector/overlay.js')
    const script = await fs.promises.readFile(scriptPath, 'utf-8')
    return script
  } catch (err) {
    console.error('Failed to load inspector script:', err)
    throw new Error('Inspector script not found')
  }
})
```

### apps/electron/src/preload/index.ts

Add to the API object:

```typescript
{
  // ... existing APIs
  getInspectorScript: () => ipcRenderer.invoke('inspector:get-script')
}
```

### apps/electron/src/renderer/src/types/electron.d.ts

Add type:

```typescript
interface ElectronAPI {
  // ... existing types
  getInspectorScript: () => Promise<string>
}
```

---

## Task 4: Preview Panel Integration

Add inspector toggle button and webview integration to PreviewPanel.

### apps/electron/src/renderer/src/components/PreviewPanel.tsx

Add state and handlers:

```typescript
import { useState, useCallback, useRef, useEffect } from 'react'

// Add state
const [isInspecting, setIsInspecting] = useState(false)
const webviewRef = useRef<WebviewTag | null>(null)

/**
 * Toggle inspector mode in the webview.
 */
const toggleInspector = useCallback(async () => {
  if (!webviewRef.current) return

  try {
    if (isInspecting) {
      // Deactivate
      await webviewRef.current.executeJavaScript('window.__anyappInspector?.deactivate()')
      setIsInspecting(false)
    } else {
      // Load inspector script if not already loaded
      const hasInspector = await webviewRef.current.executeJavaScript(
        'typeof window.__anyappInspector !== "undefined"'
      )

      if (!hasInspector) {
        // Read and inject the overlay script
        const overlayScript = await window.electronAPI.getInspectorScript()
        await webviewRef.current.executeJavaScript(overlayScript)
      }

      // Activate
      await webviewRef.current.executeJavaScript('window.__anyappInspector?.activate()')
      setIsInspecting(true)
    }
  } catch (err) {
    console.error('Failed to toggle inspector:', err)
  }
}, [isInspecting])

/**
 * Handle element selection messages from webview.
 */
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'anyapp:element-selected') {
      const elementInfo = event.data.data
      console.log('Element selected:', elementInfo)

      // Auto-exit inspect mode after selection
      setIsInspecting(false)
      if (webviewRef.current) {
        webviewRef.current.executeJavaScript('window.__anyappInspector?.deactivate()')
      }
    }
  }

  window.addEventListener('message', handleMessage)
  return () => window.removeEventListener('message', handleMessage)
}, [])
```

Add inspect button to toolbar (find the toolbar section and add):

```tsx
{/* Inspect button */}
<button
  onClick={toggleInspector}
  className={`rounded px-2 py-1 text-xs transition ${
    isInspecting
      ? 'bg-blue-600 text-white'
      : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
  }`}
  title={isInspecting ? 'Exit inspect mode (ESC)' : 'Inspect elements'}
>
  {isInspecting ? '✓ Inspecting' : '🔍 Inspect'}
</button>
```

Add ref to the webview tag:

```tsx
<webview
  ref={webviewRef}
  // ... existing props
/>
```

---

## Task 5: ESC Key to Exit

Add keyboard shortcut to exit inspect mode.

### apps/electron/src/renderer/src/components/PreviewPanel.tsx

Add effect:

```typescript
/**
 * ESC key exits inspect mode.
 */
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isInspecting) {
      toggleInspector()
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [isInspecting, toggleInspector])
```

---

## Verification Checklist

- [ ] Inspector overlay script compiles without errors
- [ ] `bun run build` produces `packages/shared/dist/inspector/overlay.js`
- [ ] Inspect button appears in PreviewPanel toolbar
- [ ] Clicking "Inspect" button activates inspector mode
- [ ] Elements highlight on hover with blue border
- [ ] Cursor changes to crosshair in inspect mode
- [ ] Clicking an element logs ElementInfo to console
- [ ] Selected element flashes green briefly
- [ ] Inspector auto-exits after selecting an element
- [ ] ESC key exits inspect mode
- [ ] "✓ Inspecting" shows when mode is active
- [ ] `bun run typecheck:all` passes

---

## Testing

1. Start the dev server: `bun run dev`
2. Create a React app and run it
3. Click "🔍 Inspect" in the preview panel
4. Hover over elements — they should highlight with blue border
5. Click an element — should flash green and log to console
6. Check console for ElementInfo object with tag, classes, selector, etc.
7. Press ESC — inspector should exit

---

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/inspector/overlay.ts` | **New** — Inspector overlay script |
| `packages/shared/tsconfig.json` | **Modified** — Ensure inspector is compiled |
| `apps/electron/src/main/ipc.ts` | **Modified** — Add `inspector:get-script` handler |
| `apps/electron/src/preload/index.ts` | **Modified** — Add `getInspectorScript` API |
| `apps/electron/src/renderer/src/types/electron.d.ts` | **Modified** — Type `getInspectorScript` |
| `apps/electron/src/renderer/src/components/PreviewPanel.tsx` | **Modified** — Add inspect button, toggle logic, message handler |

---

## Commit Checkpoint

```bash
bun run build
bun run typecheck:all

git add -A
git commit -m "feat(inspector): element inspection overlay (Session 13.1)

- Client-side inspector overlay with hover highlights
- Click-to-select elements in preview webview
- DOM info extraction (tag, classes, selectors, XPath)
- Inject/activate inspector via executeJavaScript
- Inspect mode toggle button in preview panel
- ESC key exits inspect mode
- Element selection posts message to parent window"
```

---

## Next Steps

Continue to [Session 13.2: Context Injection](SESSION-13.2-CONTEXT-INJECTION.md) to add screenshot capture and chat integration.
