/**
 * Fenced code block for rendered markdown, with syntax highlighting.
 *
 * Highlighting is done here rather than through `rehype-highlight`, which
 * statically imports lowlight's `common` set — around forty grammars that
 * doubled the renderer bundle whether or not they were ever used. Driving
 * lowlight directly lets the registered set be the languages this agent
 * actually writes.
 */

import { createElement, useCallback, useMemo, useState } from 'react'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { CheckIcon, CopyIcon } from './icons'
import type { ReactNode } from 'react'
import type { Element, ElementContent, Root } from 'hast'

/**
 * Props for the CodeBlock component.
 */
interface CodeBlockProps {
  /** The code, exactly as the model wrote it. */
  source: string
  /** Language from the fence info string, if the model supplied one. */
  language?: string
  /**
   * Whether to highlight. False while a message is still streaming, when the
   * code is incomplete and the colors would only churn.
   */
  highlight?: boolean
}

/** How long the copy button stays in its confirmed state. */
const COPIED_FEEDBACK_MS = 1500

/**
 * The grammars the highlighter knows.
 *
 * Each highlight.js language carries its own aliases, which lowlight registers
 * too — so `ts`, `js`, `sh`, `html`, `yml`, and `py` resolve without being
 * listed here. An unregistered language still renders as a code block, just
 * uncolored, so the cost of an omission is small and the fix is one line.
 */
const lowlight = createLowlight({
  bash,
  css,
  diff,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  // Covers HTML, SVG, and markup-shaped dialects.
  xml,
  yaml
})

/*
 * highlight.js aliases `sh` to bash but not `shell` or `console`, which are
 * exactly the fence labels a model reaches for when it pastes a terminal
 * session. Point them at the shell grammar rather than losing the color.
 */
lowlight.registerAlias({ bash: ['shell', 'console'] })

/**
 * Convert lowlight's hast output into React elements.
 *
 * The tree lowlight returns is deliberately narrow — text nodes and `span`s
 * carrying `hljs-*` classes — so a short recursive walk beats pulling in a
 * general hast-to-JSX runtime, and keeps the app's rule of never handing a
 * rendered HTML string to the DOM.
 * @param nodes - Children of a hast root or element
 * @returns The equivalent React nodes
 */
function toReact(nodes: ElementContent[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value
    if (node.type !== 'element') return null

    const element = node as Element
    const className = element.properties?.className
    return createElement(
      element.tagName,
      {
        key: index,
        className: Array.isArray(className) ? className.join(' ') : undefined
      },
      toReact(element.children as ElementContent[])
    )
  })
}

/**
 * Renders a fenced code block with a language label and a copy button.
 */
export function CodeBlock({ source, language, highlight = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(source).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      },
      () => {
        // Clipboard access can be refused; leaving the button idle is the
        // honest outcome — better than claiming a copy that did not happen.
      }
    )
  }, [source])

  const body = useMemo<ReactNode>(() => {
    if (!highlight || !language || !lowlight.registered(language)) return source

    try {
      const tree = lowlight.highlight(language, source) as Root
      return toReact(tree.children as ElementContent[])
    } catch {
      // A grammar can throw on pathological input. Uncolored code is still
      // readable code, so fall back rather than losing the block.
      return source
    }
  }, [source, language, highlight])

  return (
    <div className="my-3 overflow-hidden rounded border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-raised px-3 py-1.5">
        <span className="eyebrow text-ash">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ash transition-colors hover:text-bone"
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto bg-panel p-3">
        <code className="font-mono text-[12.5px] leading-relaxed text-bone">{body}</code>
      </pre>
    </div>
  )
}
