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
    <div className="my-2 overflow-hidden rounded-lg border border-brass/40 bg-brass/10">
      {/* Screenshot */}
      {screenshot && (
        <div className="border-b border-brass/40 bg-panel/50 p-2">
          <img
            src={screenshot}
            alt="Selected element"
            className="max-h-48 rounded border border-line"
          />
        </div>
      )}

      {/* Element info */}
      <div className="space-y-1 p-3 text-xs">
        <div>
          <span className="text-ash">Tag:</span>{' '}
          <code className="text-brass">{element.tag}</code>
        </div>

        {element.id && (
          <div>
            <span className="text-ash">ID:</span>{' '}
            <code className="text-brass">#{element.id}</code>
          </div>
        )}

        {element.classes.length > 0 && (
          <div>
            <span className="text-ash">Classes:</span>{' '}
            <code className="text-ash">{element.classes.join(' ')}</code>
          </div>
        )}

        {element.text && (
          <div>
            <span className="text-ash">Text:</span>{' '}
            <span className="text-bone">
              {element.text.length > 80 ? element.text.slice(0, 80) + '...' : element.text}
            </span>
          </div>
        )}

        <details className="mt-2">
          <summary className="cursor-pointer text-ash hover:text-bone">
            Selectors
          </summary>
          <div className="mt-1 space-y-1 pl-2">
            <div>
              <span className="text-ash">CSS:</span>{' '}
              <code className="break-all text-xs text-ash">{element.selector}</code>
            </div>
            <div>
              <span className="text-ash">XPath:</span>{' '}
              <code className="break-all text-xs text-ash">{element.xpath}</code>
            </div>
          </div>
        </details>
      </div>

      {/* Prompt hint */}
      <div className="border-t border-brass/40 bg-panel/50 px-3 py-2">
        <p className="text-xs text-ash">
          💡 Type your request below to modify this element
        </p>
      </div>
    </div>
  )
}
