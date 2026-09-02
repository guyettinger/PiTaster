/**
 * Monaco, wired for an app that must work offline.
 *
 * Two decisions matter here and both are easy to get wrong in a way that only shows up
 * in the packaged build.
 *
 * **No CDN.** `@monaco-editor/react` is the usual wrapper and it loads Monaco from
 * jsdelivr by default. anyapp's whole identity is that inference never leaves the
 * machine; an editor that silently needs the network to render is the wrong shape for
 * it, and would simply fail to appear offline. So Monaco is imported as ESM from
 * `node_modules` and the thin wrapper below replaces the React binding.
 *
 * **One worker strategy, not two.** The single worker is wired by hand through
 * `MonacoEnvironment.getWorker` with Vite's `?worker` import. Mixing that with a Monaco
 * Vite plugin is the classic way to get a build that works in `dev` and resolves a
 * different worker path once packaged.
 *
 * **No TypeScript language service is registered, deliberately.** Monaco 0.56 loads every
 * language's *tokenizer* by side effect but makes the language *services* opt-in through
 * top-level `register()` calls. Leaving TypeScript's unregistered is exactly what this
 * viewer wants: Monaco's own checker cannot see the sub-app's `tsconfig.json` or its
 * `node_modules`, so registering it would paint every import as unresolved — hundreds of
 * confident, wrong squiggles. Syntax highlighting still works, because that is the
 * tokenizer. The real diagnostics come over IPC from the same language service that
 * checks the agent's writes, and are applied with `setModelMarkers`.
 *
 * **Only the tokenizers this app needs.** Importing `monaco-editor` whole registers all
 * eighty-four language definitions and takes the renderer bundle from 1.3 MB to 9 MB —
 * exactly the trap `CodeBlock.tsx` already documents for lowlight's `common` set. The
 * editor core comes from `editor/editor.api` and the grammars are imported one at a time.
 */

import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// The tokenizers, one import per language, registered by side effect. Importing
// `monaco-editor` whole instead pulls in all eighty-four and takes the renderer bundle
// from 1.3 MB to 9 MB — the same trap `CodeBlock.tsx` documents for lowlight's `common`
// set. This list is the languages the agent actually writes, and it mirrors the
// grammars registered there; adding one is a line in each place.
import 'monaco-editor/languages/definitions/typescript/register'
import 'monaco-editor/languages/definitions/javascript/register'
import 'monaco-editor/languages/definitions/css/register'
import 'monaco-editor/languages/definitions/html/register'
import 'monaco-editor/languages/definitions/markdown/register'
import 'monaco-editor/languages/definitions/shell/register'
import 'monaco-editor/languages/definitions/yaml/register'
import 'monaco-editor/languages/definitions/python/register'
import 'monaco-editor/languages/definitions/rust/register'
import 'monaco-editor/languages/definitions/go/register'
import 'monaco-editor/languages/definitions/sql/register'
import 'monaco-editor/languages/definitions/xml/register'

declare global {
  interface Window {
    /** Monaco reads its worker factory off the global object. */
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker }
  }
}

let configured = false

/**
 * Wire Monaco's workers and theme. Safe to call more than once.
 *
 * @returns The Monaco namespace, ready to create editors with
 */
export function setupMonaco(): typeof monaco {
  if (configured) return monaco
  configured = true

  // One worker, because only tokenization is in play — see the module comment on why no
  // language service is registered.
  window.MonacoEnvironment = { getWorker: () => new EditorWorker() }

  // The palette, so the editor reads as part of the app rather than as VS Code embedded
  // in it. Token colours map onto the same brass/patina/rust the chat's code blocks use.
  monaco.editor.defineTheme('anyapp', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'd2a24c' },
      { token: 'string', foreground: '6fa292' },
      { token: 'number', foreground: '6fa292' },
      { token: 'comment', foreground: '878d97', fontStyle: 'italic' },
      { token: 'type', foreground: 'd2a24c' },
      { token: 'delimiter', foreground: 'e7e5e0' }
    ],
    colors: {
      'editor.background': '#191b1f',
      'editor.foreground': '#e7e5e0',
      'editorLineNumber.foreground': '#878d97',
      'editorLineNumber.activeForeground': '#e7e5e0',
      'editor.selectionBackground': '#2e323a',
      'editor.lineHighlightBackground': '#23262b',
      'editorGutter.background': '#191b1f',
      'editorWidget.background': '#23262b',
      'editorWidget.border': '#2e323a'
    }
  })

  return monaco
}

/** Extensions Monaco should treat as a given language. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // JSON has no basic tokenizer in Monaco; it comes from the JSON language *feature*,
  // which costs 3.2 MB of bundle for a worker that validates schemas nobody asked it to.
  // The JavaScript tokenizer colours JSON correctly — strings, numbers, delimiters — for
  // nothing, and `package.json` is far too commonly opened to leave as plain text.
  json: 'javascript',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell'
}

/**
 * Guess a file's language from its name.
 * @param path - The file's path
 * @returns Monaco's language id, or `plaintext`
 */
export function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext'
}
