/**
 * Tests for the element-context validator.
 *
 * Two properties matter. A well-formed context from the inspector must pass
 * unchanged — the validator sits on the path a real element selection takes, so a
 * false rejection breaks the feature outright. And every field the prompt builder
 * reads without guarding must be refused here, because the alternative is a
 * TypeError thrown while a turn is being assembled rather than an error at the
 * boundary.
 */

import { describe, expect, test } from 'bun:test'
import { assertElementContext } from './element-context'

/** A context shaped exactly as `captureElement` returns one. */
function valid(): Record<string, unknown> {
  return {
    element: {
      tag: 'button',
      text: 'Save',
      classes: ['btn', 'btn-primary'],
      id: 'save',
      selector: '#save',
      xpath: '/html/body/div/button',
      bounds: { x: 10, y: 20, width: 80, height: 32 }
    },
    screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    capturedAt: '2026-09-05T12:00:00.000Z'
  }
}

describe('assertElementContext', () => {
  test('accepts what the inspector actually produces', () => {
    expect(() => assertElementContext(valid())).not.toThrow()
  })

  test('accepts a context with no screenshot and no id, both optional', () => {
    const context = valid()
    delete context.screenshot
    delete (context.element as Record<string, unknown>).id
    expect(() => assertElementContext(context)).not.toThrow()
  })

  test('refuses anything that is not an object', () => {
    for (const value of [null, undefined, 'element', 42, []]) {
      expect(() => assertElementContext(value)).toThrow()
    }
  })

  test('refuses a missing element, which the prompt builder dereferences', () => {
    const context = valid()
    delete context.element
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses classes that are not an array', () => {
    // `describeElementContext` reads `classes.length` and calls `.join(' ')`.
    const context = valid()
    ;(context.element as Record<string, unknown>).classes = 'btn'
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses a class list longer than the cap', () => {
    const context = valid()
    ;(context.element as Record<string, unknown>).classes = Array(201).fill('c')
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses bounds that are missing, non-numeric, or not finite', () => {
    for (const bounds of [
      undefined,
      { x: 0, y: 0, width: 10 },
      { x: 0, y: 0, width: '10', height: 10 },
      { x: 0, y: 0, width: Number.NaN, height: 10 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }
    ]) {
      const context = valid()
      ;(context.element as Record<string, unknown>).bounds = bounds
      expect(() => assertElementContext(context)).toThrow()
    }
  })

  test('refuses element text past the cap', () => {
    const context = valid()
    ;(context.element as Record<string, unknown>).text = 'x'.repeat(20_001)
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses a selector past the cap', () => {
    const context = valid()
    ;(context.element as Record<string, unknown>).selector = 'a'.repeat(4001)
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses a screenshot that is not an image data URL', () => {
    for (const screenshot of ['not a url', 'data:text/html;base64,PHA+', 'javascript:alert(1)']) {
      const context = valid()
      context.screenshot = screenshot
      expect(() => assertElementContext(context)).toThrow()
    }
  })

  test('refuses a screenshot past the byte cap', () => {
    // The whole point of the size half of the check: this is what becomes an image
    // attachment on the next turn.
    const context = valid()
    context.screenshot = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`
    expect(() => assertElementContext(context)).toThrow()
  })

  test('refuses a missing capturedAt', () => {
    const context = valid()
    delete context.capturedAt
    expect(() => assertElementContext(context)).toThrow()
  })
})
