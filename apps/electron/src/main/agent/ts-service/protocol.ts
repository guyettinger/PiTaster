/**
 * The wire shapes between the main process and the TypeScript worker.
 *
 * Nothing from the `typescript` namespace appears here. The worker holds a
 * `ts.LanguageService` and the main process holds a handle to a child process, and the
 * only thing that crosses between them is plain JSON — so the compiler stays entirely
 * on one side of the port and a change to its types cannot ripple into the tools or the
 * IPC layer.
 *
 * Every response carries an explicit outcome rather than throwing. A sub-app with no
 * TypeScript in it, an unparseable `tsconfig.json`, or a worker that died is a normal
 * state of the world, not an error the edit loop should have to survive.
 */

/** A position in a file, 1-indexed the way an editor and `replace_lines` count. */
export interface FilePosition {
  /** Path relative to the sub-app root. */
  path: string
  /** Line number, 1-indexed. */
  line: number
  /** Column number, 1-indexed. */
  column: number
}

/** One compiler diagnostic. */
export interface Diagnostic extends FilePosition {
  /** The TypeScript error number, without the `TS` prefix. */
  code: number
  /** The flattened message text. */
  message: string
  /** Whether the compiler considers this fatal. */
  category: 'error' | 'warning'
}

/** One entry in a file's symbol outline. */
export interface OutlineEntry {
  /** The declared name. */
  name: string
  /** A human-readable kind: `function`, `class`, `interface`, `method`, … */
  kind: string
  /** First line of the declaration, 1-indexed. */
  line: number
  /** Last line of the declaration, 1-indexed. */
  endLine: number
  /** The signature or type, where one reads usefully in a list. */
  detail?: string
  /** Nesting depth, so a method can be shown under its class. */
  depth: number
}

/** One occurrence of a symbol, with the source line it sits on. */
export interface SymbolReference extends FilePosition {
  /** The trimmed text of the line, for context without a second read. */
  text: string
}

/** A declaration that a name could have meant. */
export interface SymbolCandidate {
  /** The declared name. */
  name: string
  /** A human-readable kind. */
  kind: string
  /** Line of the declaration, 1-indexed. */
  line: number
}

/** Requests the worker answers. */
export type ServiceRequest =
  | { kind: 'diagnostics'; path: string }
  | { kind: 'projectDiagnostics'; paths: string[] }
  | { kind: 'outline'; path: string }
  | { kind: 'readSymbol'; path: string; symbol: string }
  | { kind: 'definition'; path: string; symbol: string }
  | { kind: 'references'; path: string; symbol: string }
  | { kind: 'hover'; path: string; symbol: string }
  | { kind: 'rename'; path: string; symbol: string; newName: string }
  | { kind: 'organizeImports'; path: string }
  | { kind: 'applyFix'; path: string; line: number }
  | { kind: 'invalidate'; paths: string[] }
  | { kind: 'referencingFiles'; path: string }

/**
 * A file the worker rewrote, as whole new contents.
 *
 * Whole contents rather than a patch because the worker holds the authoritative text
 * already and the caller has to write the file anyway; handing back a patch would mean
 * both sides re-deriving what the compiler computed exactly.
 */
export interface FileEdit {
  /** Path relative to the sub-app root. */
  path: string
  /** The file's full text after the edit. */
  text: string
}

/** Responses the worker returns. */
export type ServiceResponse =
  | { kind: 'diagnostics'; diagnostics: Diagnostic[] }
  | { kind: 'outline'; entries: OutlineEntry[] }
  | { kind: 'text'; text: string; line: number; endLine: number }
  | { kind: 'locations'; locations: SymbolReference[] }
  | { kind: 'edits'; edits: FileEdit[]; description: string }
  | { kind: 'paths'; paths: string[] }
  | { kind: 'ok' }
  | { kind: 'ambiguous'; candidates: SymbolCandidate[] }
  | { kind: 'notFound'; message: string }
  | { kind: 'unavailable'; message: string }

/** A request in flight, as it travels over the port. */
export interface WorkerRequestEnvelope {
  /** Correlates the reply. */
  id: number
  /** What to do. */
  request: ServiceRequest
}

/** A reply, as it travels back. */
export interface WorkerResponseEnvelope {
  /** The `id` of the request this answers. */
  id: number
  /** The answer, or `null` when `error` is set. */
  response: ServiceResponse | null
  /** Set when the worker could not answer at all. */
  error?: string
}
