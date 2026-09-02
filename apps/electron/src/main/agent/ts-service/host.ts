/**
 * A `ts.LanguageService` rooted at one sub-app.
 *
 * The host is where confinement comes from, and it is worth being exact about how. The
 * model never hands the compiler a path: it names a file relative to the app root, and
 * {@link TsProject.resolve} joins it and refuses anything that escapes. What the host
 * itself serves is the app's own sources, whatever those sources import from the app's
 * `node_modules`, and TypeScript's bundled `lib.*.d.ts` — the last of which lives inside
 * anyapp's own dependency tree rather than the user's, and without which nothing type
 * checks at all.
 *
 * A missing or unparseable `tsconfig.json` is not an error. Two of the five sub-app
 * templates ship no TypeScript config, and a code-intelligence layer that refuses to
 * start on a plain JavaScript project would be worse than none — so the config is
 * inferred instead, deliberately loosely.
 */

import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/**
 * Directory names never scanned for project files.
 *
 * `node_modules` is here for size — a sub-app that has run `install_deps` holds tens of
 * thousands of files, and enumerating them as *project* sources would build a program
 * over the whole dependency tree. Their type declarations still reach the compiler, but
 * through module resolution, which pulls in only what is actually imported.
 */
const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', 'out', '.vite', '.git', 'coverage']

/** Extensions treated as project sources. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Compiler options used when the sub-app has no `tsconfig.json`.
 *
 * Deliberately permissive. An inferred config means anyapp is guessing at the project's
 * intent, and a guess that reports a hundred errors the author never asked for would
 * flood the model's context with noise it cannot act on. `strict` stays off, JSX is
 * assumed React, and `allowJs` is on so a plain JavaScript template still gets syntax
 * and obvious type errors.
 */
const INFERRED_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: false,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true
}

/**
 * A language service and the bookkeeping that keeps it current.
 */
export interface TsProject {
  /** The service itself. */
  service: ts.LanguageService
  /** Absolute path to the sub-app root. */
  rootPath: string
  /**
   * Resolve a model-supplied path against the root.
   * @param path - Path as given, relative to the root or absolute inside it
   * @returns The absolute path, or `null` if it escapes the root
   */
  resolve: (path: string) => string | null
  /**
   * Express an absolute path the way the model refers to it.
   * @param absolutePath - An absolute path inside the root
   * @returns The root-relative path, with forward slashes
   */
  relativize: (absolutePath: string) => string
  /**
   * Whether an absolute path lies inside the sub-app root.
   *
   * Needed on *outputs*, not just inputs. Confining the one path the model names says
   * nothing about the paths the *compiler* names back: module resolution follows an
   * import wherever it leads, so a `references` result or a rename's edit list can
   * legitimately contain a file outside the root. `relativize` on such a path returns a
   * string of `../` segments, which rejoined against the root escapes it.
   *
   * @param absolutePath - The path to test
   * @returns True when the path is inside the root
   */
  contains: (absolutePath: string) => boolean
  /**
   * Mark files as changed so the next query rebuilds against their new contents.
   * @param absolutePaths - The files that changed; empty re-scans the whole project
   */
  invalidate: (absolutePaths: string[]) => void
  /** Whether the project holds any source files at all. */
  isEmpty: () => boolean
}

/**
 * Enumerate a sub-app's source files.
 * @param rootPath - Absolute path to the sub-app root
 * @returns Absolute paths of every file to include in the program
 */
function scanSourceFiles(rootPath: string): string[] {
  const excludes = EXCLUDED_DIRS.map((name) => `**/${name}/**`)
  try {
    return ts.sys.readDirectory(rootPath, SOURCE_EXTENSIONS, excludes, undefined)
  } catch {
    return []
  }
}

/**
 * Read the sub-app's `tsconfig.json`, if it has a usable one.
 *
 * Only the root's own config is considered. Pi discovers `AGENTS.md` by walking *up*
 * from the cwd and `context-files.ts` exists to undo that; the same reasoning applies
 * here, and more sharply — a `tsconfig.json` above `~/.anyapp/apps/` would silently
 * change how every sub-app compiles.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The parsed options and file list, or `null` to fall back to inference
 */
function readProjectConfig(
  rootPath: string
): { options: ts.CompilerOptions; fileNames: string[] } | null {
  const configPath = join(rootPath, 'tsconfig.json')
  if (!ts.sys.fileExists(configPath)) return null

  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error || !read.config) return null

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, rootPath, undefined, configPath)
  // `parsed.errors` is not fatal on its own — an unknown compiler option produces one
  // and the rest of the config is still usable. An empty file list is the real signal
  // that this config describes nothing we can work with.
  if (parsed.fileNames.length === 0) return null

  return {
    // `noEmit` regardless of what the project says. Nothing here ever writes build
    // output, and a project configured to emit would otherwise have the language
    // service doing work whose result is discarded.
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
    // An `include` of `../../` is a `tsconfig.json` the agent can write, so the file list
    // it produces is not trusted any more than a path the model types.
    fileNames: parsed.fileNames.filter(
      (fileName) => !relative(rootPath, resolve(fileName)).startsWith('..')
    )
  }
}

/**
 * Build a language service for one sub-app.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The project handle
 */
export function createTsProject(rootPath: string): TsProject {
  const config = readProjectConfig(rootPath)
  const options = config?.options ?? INFERRED_OPTIONS

  let fileNames = config?.fileNames ?? scanSourceFiles(rootPath)
  let fileNamesStale = false
  const versions = new Map<string, number>()

  const currentFileNames = (): string[] => {
    if (fileNamesStale) {
      // Re-read the config as well as the file list: an agent that just created a
      // sub-app's first `tsconfig.json` has changed how everything below compiles, and
      // a service still holding the inferred options would report errors that no longer
      // exist.
      const refreshed = readProjectConfig(rootPath)
      fileNames = refreshed?.fileNames ?? scanSourceFiles(rootPath)
      fileNamesStale = false
    }
    return fileNames
  }

  // Where TypeScript's own `lib.*.d.ts` live. Reads are allowed here as well as inside
  // the app root, because nothing type checks without them — and this directory is inside
  // anyapp's dependency tree, not the user's project, so it is ours rather than content
  // the agent can influence. Same shape as `SHELL_READONLY_PREFIXES` in the permission
  // gate: a narrow, named exception rather than an open door.
  const libDir = dirname(ts.getDefaultLibFilePath({}))

  /**
   * Whether the compiler may read a path.
   * @param fileName - The path TypeScript wants
   * @returns True when the read is allowed
   */
  const mayRead = (fileName: string): boolean => {
    const resolved = resolve(fileName)
    return !relative(rootPath, resolved).startsWith('..') || resolved.startsWith(libDir)
  }

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: currentFileNames,
    getScriptVersion: (fileName) => String(versions.get(fileName) ?? 0),
    getScriptSnapshot: (fileName) => {
      if (!mayRead(fileName)) return undefined
      const text = ts.sys.readFile(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => rootPath,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    // Every filesystem callback is gated. Left raw, module resolution would follow an
    // `import '../../other-app/src/config'` out of the root and pull that file into the
    // program — where `references` would quote its source lines back and `rename` would
    // offer to rewrite it.
    fileExists: (fileName) => mayRead(fileName) && ts.sys.fileExists(fileName),
    readFile: (fileName, encoding) =>
      mayRead(fileName) ? ts.sys.readFile(fileName, encoding) : undefined,
    readDirectory: (dir, extensions, exclude, include, depth) =>
      mayRead(dir) ? ts.sys.readDirectory(dir, extensions, exclude, include, depth) : [],
    directoryExists: (dir) => mayRead(dir) && ts.sys.directoryExists(dir),
    getDirectories: (dir) => (mayRead(dir) ? ts.sys.getDirectories(dir) : []),
    realpath: ts.sys.realpath
  }

  const service = ts.createLanguageService(host, ts.createDocumentRegistry())

  return {
    service,
    rootPath,

    resolve: (path: string) => {
      // Mirrors the shape of `resolveLikePi` in `permission-gate.ts` for the cases the
      // compiler can encounter, without importing it: this runs in the worker process,
      // where the permission gate has no business being. The gate has already refused
      // anything out of root before a tool reaches here; this is the second check that
      // keeps that true if the tool surface ever changes.
      const trimmed = path.trim()
      if (trimmed.length === 0) return null
      const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootPath, trimmed)
      const rel = relative(rootPath, absolutePath)
      if (rel.length === 0) return null
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
      return absolutePath
    },

    relativize: (absolutePath: string) => relative(rootPath, absolutePath).split(sep).join('/'),

    contains: (absolutePath: string) => {
      const rel = relative(rootPath, absolutePath)
      return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    },

    invalidate: (absolutePaths: string[]) => {
      if (absolutePaths.length === 0) {
        fileNamesStale = true
        return
      }
      for (const path of absolutePaths) {
        versions.set(path, (versions.get(path) ?? 0) + 1)
        // A file the program has never seen is a new file, and a new file changes the
        // file list, not just a version. Checking membership is cheaper than re-scanning
        // on every write.
        if (!currentFileNames().includes(path)) fileNamesStale = true
      }
    },

    isEmpty: () => currentFileNames().length === 0
  }
}
