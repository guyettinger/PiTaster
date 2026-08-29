/**
 * Utilities for converting app-specific types to Claude API format.
 */

import type { ElementContext } from '@anyapp/core'

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
