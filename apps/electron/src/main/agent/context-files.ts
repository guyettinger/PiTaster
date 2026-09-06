/**
 * Confines Pi's `AGENTS.md` / `CLAUDE.md` discovery to the active sub-app.
 *
 * Pi finds context files by walking *up* the directory tree from `cwd` and also reading
 * `agentDir` (`dist/core/resource-loader.js:32-51`), then wraps everything it finds in a
 * `<project_context>` block on the system prompt. Sub-apps live under `~/.keylimepi/apps/`,
 * so without a filter a file at `~/.keylimepi/AGENTS.md` — or `~/AGENTS.md`, or Key Lime Pi's own
 * if a sub-app were ever created inside the repository — entered every session's prompt:
 * unbounded text against a window as small as 32k, invisible in the UI, and describing a
 * different project.
 *
 * A sub-app's own `AGENTS.md` is legitimate and stays supported. Only the ancestry is
 * dropped.
 */

import { resolve } from 'node:path'
import { isWithinRoot } from './permission-gate'

/** One context file, in the shape Pi's `agentsFilesOverride` passes and expects back. */
export interface AgentsFile {
  /** Absolute path to the file. Pi builds it with `join(dir, filename)`. */
  path: string
  /** The file's contents. */
  content: string
}

/**
 * Build the `agentsFilesOverride` filter for one sub-app.
 *
 * Paths arrive absolute — Pi joins each candidate filename onto a directory from its
 * ancestry walk, which starts at an absolute `cwd` — so the `resolve` here only
 * normalizes. It is kept because {@link isWithinRoot} compares resolved paths, and a
 * relative path reaching it would silently be measured against the process cwd instead.
 *
 * @param rootPath - The sub-app root
 * @returns A filter keeping only the files inside that root
 */
export function confineContextFiles(
  rootPath: string
): (base: { agentsFiles: AgentsFile[] }) => { agentsFiles: AgentsFile[] } {
  return (base) => ({
    agentsFiles: base.agentsFiles.filter((file) => isWithinRoot(rootPath, resolve(file.path)))
  })
}
