/**
 * Dependency installation for sub-apps.
 *
 * Shared by the Install button's IPC handler and the agent's `install_deps` tool
 * so both spawn `bun install` the same way — same cwd, same filtered environment,
 * same log stream. A second spawn site would be a second chance to forget the
 * credential filter.
 */

import { spawn } from 'node:child_process'
import { buildSubprocessEnv } from '../process/env.js'

/**
 * Parameters for {@link installDependencies}.
 */
export interface InstallDependenciesParams {
  /** Absolute path to the sub-app root; `bun install` runs here. */
  appPath: string
  /** Called for each chunk of subprocess output. */
  onLog?: (params: { type: 'stdout' | 'stderr'; message: string }) => void
  /** Aborts the install when signalled. */
  signal?: AbortSignal
}

/**
 * The outcome of an install run.
 */
export interface InstallDependenciesResult {
  /** Process exit code, or null when the process was killed by a signal. */
  exitCode: number | null
  /** Combined stdout and stderr, for reporting back to a caller that did not stream. */
  output: string
}

/** Bytes of subprocess output retained; the rest is streamed but not accumulated. */
const MAX_CAPTURED_OUTPUT = 16_000

/**
 * Run `bun install` in a sub-app directory.
 *
 * The child process receives a filtered environment ({@link buildSubprocessEnv}),
 * so the user's API keys never reach it. Rejects only when the process cannot be
 * spawned; a non-zero exit is returned in {@link InstallDependenciesResult.exitCode}
 * so callers can decide whether that is an error.
 *
 * @param params - The app path, an optional log sink, and an optional abort signal
 * @returns The exit code and captured output
 * @throws {Error} If the `bun` executable cannot be spawned
 */
export function installDependencies(
  params: InstallDependenciesParams
): Promise<InstallDependenciesResult> {
  const { appPath, onLog, signal } = params

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['install'], {
      cwd: appPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSubprocessEnv()
    })

    let output = ''

    const collect = (type: 'stdout' | 'stderr') => (data: Buffer): void => {
      const message = data.toString()
      if (output.length < MAX_CAPTURED_OUTPUT) {
        output += message
      }
      onLog?.({ type, message })
    }

    proc.stdout?.on('data', collect('stdout'))
    proc.stderr?.on('data', collect('stderr'))

    const onAbort = (): void => {
      proc.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: code, output: output.slice(0, MAX_CAPTURED_OUTPUT) })
    })

    proc.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}
