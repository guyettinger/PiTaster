/**
 * Reading a sub-app's files for the UI.
 *
 * The renderer has had no way to read a file at all — there is no `readFile` IPC — which
 * is why there is no file tree and why `getDiff` has sat plumbed through preload with no
 * consumer. This is that missing layer.
 *
 * **Confinement is imported, never reimplemented.** `resolveLikePi` and `isWithinRoot`
 * come from `agent/permission-gate.ts`, the same functions that decide what the *agent*
 * may touch. A second resolver here would be a second idea of what "inside the app" means,
 * and the two would drift — the human's view would show files the agent cannot reach, or
 * worse, the reverse. One resolver, one boundary.
 *
 * The renderer is untrusted, and that cuts two ways. `filePath` is checked for type and
 * length in the IPC handler before it reaches these functions. `rootPath` matters more:
 * it is the value the confinement is performed *against*, so a caller who could choose it
 * would not be confined at all — asking for `.ssh/id_rsa` with the home directory as the
 * root passes every check here. `withWorkspace` in `main/workspaces.ts` is what makes that
 * impossible; it accepts only paths `AppManager` recognises as sub-app roots.
 *
 * **Symlinks are not resolved**, and neither `stat` nor `readFile` refuses to follow one.
 * A symlink planted inside the root pointing outside it — the agent can make one, `ln` is
 * not in the shell blocklist — will be read through. That is the same limitation
 * `resolveLikePi`/`isWithinRoot` already carry for the agent's own `read`, documented in
 * `AGENTS.md` as best-effort; reusing them here inherits it rather than adding to it.
 * The tree walk is not exposed to this: `Dirent.isFile()` and `isDirectory()` are both
 * false for a symlink, so `walk` skips them.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { isWithinRoot, resolveLikePi } from './agent/permission-gate'

/**
 * Directories never listed.
 *
 * `node_modules` is the reason this list exists: an installed sub-app holds tens of
 * thousands of files, and walking them would hang the tree for something nobody wants to
 * browse. The rest is build output.
 */
const HIDDEN_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.vite', '.git', 'coverage'])

/**
 * Largest file returned to the renderer.
 *
 * The viewer is for source, and a bundle or a binary read into a React state atom is a
 * frozen window. Refusing with a reason beats loading it.
 */
const MAX_READ_BYTES = 2 * 1024 * 1024

/** How deep the tree walk goes before giving up. */
const MAX_DEPTH = 12

/** One entry in a sub-app's file tree. */
export interface FileNode {
  /** Path relative to the app root, with forward slashes. */
  path: string
  /** The file or directory name alone. */
  name: string
  /** What it is. */
  kind: 'file' | 'directory'
  /** Children, for a directory. */
  children?: FileNode[]
}

/** A file's contents, as the viewer needs them. */
export interface FileContents {
  /** Path relative to the app root. */
  path: string
  /** The file's text. */
  text: string
}

/**
 * Express an absolute path the way the UI refers to it.
 * @param rootPath - Absolute path to the sub-app root
 * @param absolutePath - An absolute path inside it
 * @returns The root-relative path, with forward slashes
 */
function relativize(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(sep).join('/')
}

/**
 * Walk a directory into a tree of source files.
 *
 * @param params - The app root, the directory to walk, and how deep it already is
 * @returns The directory's children, sorted directories-first then by name
 */
async function walk(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Absolute path to the directory being listed. */
  dir: string
  /** How many levels below the root this directory sits. */
  depth: number
}): Promise<FileNode[]> {
  const { rootPath, dir, depth } = params
  if (depth > MAX_DEPTH) return []

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // An unreadable directory is a gap in the tree, not a failure of the panel.
    return []
  }

  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue
    if (entry.isDirectory() && HIDDEN_DIRS.has(entry.name)) continue

    const absolutePath = join(dir, entry.name)
    // Belt and braces on the walk. `readdir` cannot return an entry outside the directory
    // it was given, so this never fires today — it is here so that a future change to how
    // the walk is seeded cannot quietly start listing files from outside the root.
    if (!isWithinRoot(rootPath, absolutePath)) continue

    if (entry.isDirectory()) {
      nodes.push({
        path: relativize(rootPath, absolutePath),
        name: entry.name,
        kind: 'directory',
        children: await walk({ rootPath, dir: absolutePath, depth: depth + 1 })
      })
    } else if (entry.isFile()) {
      nodes.push({
        path: relativize(rootPath, absolutePath),
        name: entry.name,
        kind: 'file'
      })
    }
  }

  return nodes.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1
  )
}

/**
 * List a sub-app's source files as a tree.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns The tree's top-level entries
 */
export async function listAppFiles(rootPath: string): Promise<FileNode[]> {
  return walk({ rootPath, dir: rootPath, depth: 0 })
}

/**
 * Read one file from inside a sub-app.
 *
 * @param params - The app root and the path to read
 * @returns The file's contents
 * @throws {Error} If the path escapes the root, is not a file, or is too large
 */
export async function readAppFile(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Path relative to the root, as the UI holds it. */
  path: string
}): Promise<FileContents> {
  const { rootPath, path } = params

  const absolutePath = resolveLikePi(path, rootPath)
  if (!isWithinRoot(rootPath, absolutePath)) {
    throw new Error('That path is outside the app.')
  }

  const info = await stat(absolutePath)
  if (!info.isFile()) {
    throw new Error('That path is not a file.')
  }
  if (info.size > MAX_READ_BYTES) {
    throw new Error(`That file is ${Math.round(info.size / 1024)} KB, too large to display.`)
  }

  return { path: relativize(rootPath, absolutePath), text: await readFile(absolutePath, 'utf-8') }
}
