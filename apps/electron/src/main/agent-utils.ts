/**
 * Utilities for turning inspected UI elements into agent prompt input.
 */

import type { ImageContent } from '@earendil-works/pi-ai'
import type { ElementContext } from '@anyapp/core'

/**
 * A prompt assembled from user text plus any attached UI element context.
 */
export interface ElementPrompt {
  /** The full prompt text, with element descriptions appended. */
  prompt: string
  /** Screenshots of the selected elements, in the order they were attached. */
  images: ImageContent[]
}

/**
 * Parameters for {@link elementContextToPrompt}.
 */
export interface ElementContextToPromptParams {
  /** The user's own message text. */
  text: string
  /** Element contexts captured from the preview panel. */
  elements: ElementContext[]
}

/**
 * Describe one inspected element in plain text for the model.
 * @param context - The captured element context
 * @returns A `[UI Element Context]` block describing the element
 */
export function describeElementContext(context: ElementContext): string {
  const { element } = context

  const lines = [
    '[UI Element Context]',
    `Tag: <${element.tag}>`,
    ...(element.id ? [`ID: #${element.id}`] : []),
    ...(element.classes.length > 0 ? [`Classes: ${element.classes.join(' ')}`] : []),
    ...(element.text ? [`Text: "${element.text}"`] : []),
    `CSS Selector: ${element.selector}`,
    `XPath: ${element.xpath}`,
    `Bounds: ${element.bounds.width}×${element.bounds.height}px at (${element.bounds.x}, ${element.bounds.y})`,
    '',
    'You can use the selector to locate this element in the source files.'
  ]

  return lines.join('\n')
}

/**
 * Extract the raw base64 payload from a data URL.
 * @param screenshot - A `data:image/...;base64,...` URL
 * @returns The base64 payload without its data-URL prefix
 */
function stripDataUrlPrefix(screenshot: string): string {
  return screenshot.replace(/^data:image\/\w+;base64,/, '')
}

/**
 * Build the prompt text and image attachments for a message.
 *
 * Pi takes images alongside the prompt rather than interleaved in a content array,
 * and its `ImageContent` uses a flat `data`/`mimeType` pair where the Anthropic API
 * used a nested `source` object with `media_type`.
 *
 * @param params - The user's text and any attached element contexts
 * @returns The combined prompt text and its image attachments
 */
export function elementContextToPrompt(
  params: ElementContextToPromptParams
): ElementPrompt {
  const { text, elements } = params

  const sections = elements.map(describeElementContext)
  const prompt = [text, ...sections].filter((part) => part.length > 0).join('\n\n')

  const images: ImageContent[] = elements
    .filter((context) => Boolean(context.screenshot))
    .map((context) => ({
      type: 'image',
      data: stripDataUrlPrefix(context.screenshot as string),
      mimeType: 'image/png'
    }))

  return { prompt, images }
}
