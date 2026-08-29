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
let bannerOverlay: HTMLDivElement | null = null

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

  // Hide banner
  if (bannerOverlay) {
    bannerOverlay.style.display = 'none'
  }

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
