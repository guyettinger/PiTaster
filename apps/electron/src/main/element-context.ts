/**
 * Validation for the element context the inspector produces.
 *
 * An {@link ElementContext} is the one renderer-supplied structure in the app that
 * is both nested and unbounded by nature: it carries free text lifted out of the
 * inspected DOM and a base64 PNG. It arrives on two channels —
 * `chat:add-element-context`, which broadcasts it into a composer, and
 * `agent:message`, where an `element` block's payload is turned into prompt text and
 * an image attachment for the model.
 *
 * The bound is written here rather than at either handler for the same reason
 * `MAX_ID_LENGTH` lives in `session-baselines.ts`: a check at one channel is a check
 * the other channel does not have, and it is `agent:message` — the one that reaches
 * the model — that would have been left open.
 *
 * Shape is checked as well as size, because `describeElementContext` reads
 * `element.classes.length` and `element.bounds.width` without guarding them. A
 * malformed context does not fail at the boundary there; it throws a TypeError in
 * the middle of building a prompt, on a turn the user has already started.
 */

import type { ElementContext } from '@keylimepi/core'

/**
 * The longest accepted value for a short element field — the tag, the id, the CSS
 * selector, the XPath, the capture timestamp, and one class name.
 *
 * Generated selectors and XPaths on a deep tree run long, so this is deliberately
 * roomy; nothing legitimate approaches it.
 */
const MAX_FIELD_CHARS = 4000

/**
 * The longest accepted element text.
 *
 * This is the inspected node's rendered text, so selecting a container yields the
 * whole subtree's text. It goes into the prompt verbatim, and the context trimmer
 * never sees it — it shapes tool results, not the user's own message — so this is
 * the only thing bounding it.
 */
const MAX_TEXT_CHARS = 20_000

/** The most class names kept from one element. */
const MAX_CLASSES = 200

/**
 * The largest accepted screenshot, in bytes of the data URL.
 *
 * `captureRegion` resizes the crop back down to the element's CSS bounds, so even a
 * full-window selection lands in the low megabytes once base64 has inflated it by a
 * third. Eight is generous by several times over and still bounded.
 */
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

/** Data URLs the inspector can legitimately produce. */
const SCREENSHOT_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/

/**
 * Whether a value is a plain object rather than an array or null.
 * @param value - The value to test
 * @returns True when it is a non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is a string within a length bound.
 * @param value - The value to test
 * @param max - The longest accepted length
 * @returns True when it is a string no longer than `max`
 */
function isBoundedString(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length <= max
}

/**
 * Whether a value is a finite number, which is what the bounds must be.
 *
 * `JSON.stringify` turns `NaN` and `Infinity` into `null`, so these arrive over IPC
 * as structured-cloned numbers and have to be rejected explicitly.
 *
 * @param value - The value to test
 * @returns True when it is a finite number
 */
function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Reject an element context the renderer should never have sent.
 *
 * @param value - The value received over IPC
 * @throws {Error} If it is not a well-formed, bounded element context
 */
export function assertElementContext(value: unknown): asserts value is ElementContext {
  if (!isRecord(value)) throw new Error('Invalid element context')

  const { element, screenshot, capturedAt } = value

  if (!isRecord(element)) throw new Error('Invalid element context: element')

  if (
    !isBoundedString(element.tag, MAX_FIELD_CHARS) ||
    !isBoundedString(element.selector, MAX_FIELD_CHARS) ||
    !isBoundedString(element.xpath, MAX_FIELD_CHARS) ||
    !isBoundedString(element.text, MAX_TEXT_CHARS)
  ) {
    throw new Error('Invalid element context: element fields')
  }

  if (element.id !== undefined && !isBoundedString(element.id, MAX_FIELD_CHARS)) {
    throw new Error('Invalid element context: element id')
  }

  if (
    !Array.isArray(element.classes) ||
    element.classes.length > MAX_CLASSES ||
    !element.classes.every((entry) => isBoundedString(entry, MAX_FIELD_CHARS))
  ) {
    throw new Error('Invalid element context: classes')
  }

  const bounds = element.bounds
  if (
    !isRecord(bounds) ||
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height)
  ) {
    throw new Error('Invalid element context: bounds')
  }

  if (!isBoundedString(capturedAt, MAX_FIELD_CHARS)) {
    throw new Error('Invalid element context: capturedAt')
  }

  if (screenshot !== undefined) {
    if (typeof screenshot !== 'string' || !SCREENSHOT_PREFIX.test(screenshot)) {
      throw new Error('Invalid element context: screenshot')
    }
    // Measured in bytes rather than characters, matching `MAX_LAYOUT_BYTES`: the
    // question a size cap answers is how much reaches disk and the model, and base64
    // is one byte per character only until something non-ASCII is spliced in.
    if (Buffer.byteLength(screenshot, 'utf-8') > MAX_SCREENSHOT_BYTES) {
      throw new Error('Invalid element context: screenshot too large')
    }
  }
}
