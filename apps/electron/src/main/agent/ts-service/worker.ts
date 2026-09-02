/**
 * The TypeScript language service, running in its own process.
 *
 * It is out of the main process for one reason: `ts.LanguageService` is synchronous and
 * CPU-bound, and its *first* call builds a whole program — for a sub-app that has run
 * `install_deps`, that means parsing React's type declarations and everything they pull
 * in. Seconds, on the thread that also runs the window and pumps the agent's event
 * stream. A frozen UI mid-turn would look exactly like the stall `stall-notifier.ts`
 * exists to explain, and would not be one.
 *
 * The process holds exactly one project, named by `process.argv[2]`, and answers
 * {@link ServiceRequest}s over Electron's parent port. It never throws across the port:
 * a failure comes back as `error` on the envelope, and the client turns that into
 * "unavailable", which every caller treats as *no information* rather than as a
 * problem the edit loop has to handle.
 */

import { createTsProject, type TsProject } from './host'
import {
  applyFix,
  definition,
  fileDiagnostics,
  hover,
  organizeImports,
  outline,
  readSymbol,
  references,
  referencingFiles,
  rename
} from './queries'
import type {
  ServiceRequest,
  ServiceResponse,
  WorkerRequestEnvelope,
  WorkerResponseEnvelope
} from './protocol'

/** The project this process serves. Built lazily so a bad root fails per request. */
let project: TsProject | null = null

/**
 * The project handle, built on first use.
 * @param rootPath - Absolute path to the sub-app root
 * @returns The project
 */
function getProject(rootPath: string): TsProject {
  if (!project) project = createTsProject(rootPath)
  return project
}

/**
 * Answer one request.
 * @param rootPath - Absolute path to the sub-app root
 * @param request - What to do
 * @returns The response to send back
 */
function handle(rootPath: string, request: ServiceRequest): ServiceResponse {
  const handle = getProject(rootPath)

  if (request.kind === 'invalidate') {
    handle.invalidate(
      request.paths.map((path) => handle.resolve(path)).filter((path): path is string => !!path)
    )
    return { kind: 'ok' }
  }

  if (handle.isEmpty()) {
    return {
      kind: 'unavailable',
      message: 'This app has no TypeScript or JavaScript source files.'
    }
  }

  if (request.kind === 'projectDiagnostics') {
    const diagnostics = request.paths
      .map((path) => handle.resolve(path))
      .filter((path): path is string => !!path)
      .flatMap((path) => fileDiagnostics(handle, path))
    return { kind: 'diagnostics', diagnostics }
  }

  const absolutePath = handle.resolve(request.path)
  if (!absolutePath) {
    return { kind: 'notFound', message: `${request.path} is outside this app.` }
  }

  switch (request.kind) {
    case 'diagnostics':
      return { kind: 'diagnostics', diagnostics: fileDiagnostics(handle, absolutePath) }
    case 'referencingFiles':
      return { kind: 'paths', paths: referencingFiles(handle, absolutePath) }
    case 'outline':
      return outline(handle, absolutePath)
    case 'readSymbol':
      return readSymbol(handle, absolutePath, request.symbol)
    case 'definition':
      return definition(handle, absolutePath, request.symbol)
    case 'references':
      return references(handle, absolutePath, request.symbol)
    case 'hover':
      return hover(handle, absolutePath, request.symbol)
    case 'rename':
      return rename(handle, absolutePath, request.symbol, request.newName)
    case 'organizeImports':
      return organizeImports(handle, absolutePath)
    case 'applyFix':
      return applyFix(handle, absolutePath, request.line)
  }
}

const rootPath = process.argv[2]
const port = process.parentPort

if (rootPath && port) {
  port.on('message', (event) => {
    const envelope = event.data as WorkerRequestEnvelope
    let reply: WorkerResponseEnvelope
    try {
      reply = { id: envelope.id, response: handle(rootPath, envelope.request) }
    } catch (error) {
      reply = { id: envelope.id, response: null, error: (error as Error).message }
    }
    port.postMessage(reply)
  })
}
