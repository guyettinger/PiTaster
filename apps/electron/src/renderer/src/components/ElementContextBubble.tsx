/**
 * Display an element context block in chat.
 */

import type { ElementContext } from '@anyapp/core'

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
              {element.text.length > 80 ? element.text.slice(0, 80) + '...' : element.text}
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

      {/* Prompt hint */}
      <div className="border-t border-blue-500/30 bg-neutral-900/50 px-3 py-2">
        <p className="text-xs text-neutral-500">
          💡 Type your request below to modify this element
        </p>
      </div>
    </div>
  )
}
