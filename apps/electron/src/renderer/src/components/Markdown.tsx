/**
 * Markdown renderer for model-authored text.
 *
 * Everything the model writes arrives as markdown, so this component is the
 * transcript's typography. It renders to React elements — never through
 * `dangerouslySetInnerHTML` — and raw HTML in the source is dropped rather
 * than parsed, because the author of that HTML is a language model.
 *
 * There is no `@tailwindcss/typography` plugin in this app, so every element
 * is styled explicitly against the design tokens in `styles/globals.css`.
 */

import { memo, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import type { ComponentProps, ReactNode } from 'react'
import type { Components, Options } from 'react-markdown'

/**
 * Props for the Markdown component.
 */
interface MarkdownProps {
  /** Raw markdown source. */
  content: string
  /** Whether the text is still arriving token by token. */
  isStreaming?: boolean
}

/** GFM gives us tables, task lists, strikethrough, and bare-URL autolinks. */
const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm]


/**
 * Recover the plain source of a code fence from its rendered children.
 *
 * The copy button needs the original text, but by the time `pre` is rendered
 * the code has been split into highlight spans. Walking the React tree back to
 * a string is cheaper than threading the raw node through the pipeline.
 * @param node - Rendered children of a code element
 * @returns The concatenated text content
 */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')

  if (typeof node === 'object' && 'props' in node) {
    const props = node.props as { children?: ReactNode } | undefined
    return extractText(props?.children)
  }

  return ''
}

/**
 * Read the language out of a highlighted code element's `language-*` class.
 * @param className - The class list react-markdown wrote from the fence info
 * @returns The language name, or undefined when the fence had no info string
 */
function languageFromClassName(className: unknown): string | undefined {
  if (typeof className !== 'string') return undefined
  return className.split(/\s+/).find((name) => name.startsWith('language-'))?.slice(9)
}

/**
 * Renders markdown with Pi Taster's typography, palette, and link handling.
 */
export const Markdown = memo(function Markdown({ content, isStreaming = false }: MarkdownProps) {
  const openLink = useCallback((href: string | undefined) => {
    if (!href) return
    void window.electronAPI.openExternalUrl(href).catch(() => {
      // The main process rejects anything that is not http(s). Nothing useful
      // to show the user here — the link simply does not go anywhere.
    })
  }, [])

  const components = useMemo<Components>(
    () => ({
      // Headings step down in weight rather than size alone; a chat bubble is
      // too small a space for a six-level size ramp to read.
      h1: ({ node: _node, ...props }) => <h1 className="mt-4 mb-2 text-[16px] font-semibold text-bone first:mt-0" {...props} />,
      h2: ({ node: _node, ...props }) => <h2 className="mt-4 mb-2 text-[15px] font-semibold text-bone first:mt-0" {...props} />,
      h3: ({ node: _node, ...props }) => <h3 className="mt-3 mb-1.5 text-[14px] font-semibold text-bone first:mt-0" {...props} />,
      h4: ({ node: _node, ...props }) => <h4 className="mt-3 mb-1.5 text-[13.5px] font-semibold text-bone first:mt-0" {...props} />,
      h5: ({ node: _node, ...props }) => <h5 className="mt-3 mb-1.5 text-[13px] font-semibold text-ash first:mt-0" {...props} />,
      h6: ({ node: _node, ...props }) => <h6 className="eyebrow mt-3 mb-1.5 text-ash first:mt-0" {...props} />,

      p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,

      ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />,
      ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />,
      li: ({ node: _node, ...props }) => <li className="marker:text-ash" {...props} />,

      strong: ({ node: _node, ...props }) => <strong className="font-semibold text-bone" {...props} />,
      em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
      del: ({ node: _node, ...props }) => <del className="text-ash line-through" {...props} />,

      hr: ({ node: _node, ...props }) => <hr className="my-4 border-0 border-t border-line" {...props} />,

      blockquote: ({ node: _node, ...props }) => (
        <blockquote className="my-2 border-l-2 border-line pl-3 text-ash" {...props} />
      ),

      // Links are model-authored, so the renderer never navigates on its own:
      // the click is cancelled and the URL is handed to the main process,
      // which validates the scheme before the OS sees it. The href stays on
      // the element so the context menu can still copy it.
      a: ({ node: _node, href, children, ...rest }) => (
        <a
          href={href}
          title={href}
          onClick={(event) => {
            event.preventDefault()
            openLink(href)
          }}
          className="text-keylime underline decoration-keylime/40 underline-offset-2 transition-colors hover:decoration-keylime"
          {...rest}
        >
          {children}
        </a>
      ),

      // The renderer CSP declares no `img-src`, so it inherits `default-src
      // 'self'` and every remote or data: image is blocked. Rather than show a
      // broken frame, name the image and offer its URL as a link.
      img: ({ src, alt }) => (
        <span className="my-2 flex flex-wrap items-baseline gap-1.5 text-[12px] text-ash">
          <span className="eyebrow">Image</span>
          <span className="text-bone">{alt || 'untitled'}</span>
          {typeof src === 'string' && (
            <button
              type="button"
              onClick={() => openLink(src)}
              className="text-keylime underline decoration-keylime/40 underline-offset-2 hover:decoration-keylime"
            >
              open
            </button>
          )}
        </span>
      ),

      table: ({ node: _node, ...props }) => (
        <div className="my-3 overflow-x-auto rounded border border-line">
          <table className="w-full border-collapse text-[12.5px]" {...props} />
        </div>
      ),
      thead: ({ node: _node, ...props }) => <thead className="bg-raised" {...props} />,
      th: ({ node: _node, ...props }) => (
        <th className="border-b border-line px-3 py-1.5 text-left font-semibold text-bone" {...props} />
      ),
      td: ({ node: _node, ...props }) => <td className="border-b border-line/60 px-3 py-1.5 align-top" {...props} />,

      // react-markdown v9 dropped the `inline` prop, so block code is caught at
      // `pre` and this override only ever sees inline spans.
      code: ({ node: _node, ...props }) => (
        <code
          className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-bone"
          {...props}
        />
      ),

      pre: ({ children }) => {
        // A `pre` from markdown always wraps exactly one `code` element; that
        // is where the language class and the text both live.
        const code = Array.isArray(children) ? children[0] : children
        const codeProps =
          code && typeof code === 'object' && 'props' in code
            ? (code.props as ComponentProps<'code'>)
            : undefined

        return (
          <CodeBlock
            language={languageFromClassName(codeProps?.className)}
            source={extractText(codeProps?.children)}
            highlight={!isStreaming}
          />
        )
      }
    }),
    [openLink, isStreaming]
  )

  return (
    <div className="text-sm leading-relaxed text-bone">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
