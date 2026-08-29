/**
 * Filesystem layout for Pi session transcripts.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The Pi agent directory anyapp uses.
 *
 * Pi defaults to `~/.pi/agent`, which would scatter anyapp's data outside
 * `~/.anyapp/`. Everything the agent persists lives here instead.
 *
 * @returns Absolute path to `~/.anyapp/pi`
 */
export function getPiAgentDir(): string {
  return join(homedir(), '.anyapp', 'pi')
}

/**
 * Resolve the directory holding one sub-app's session transcripts.
 *
 * The `--<escaped path>--` naming mirrors Pi's own scheme so the directories stay
 * recognisable to Pi's tooling.
 *
 * @param params - The agent directory and the sub-app root
 * @returns Absolute path to the session directory for that app
 */
export function getAppSessionDir(params: {
  /** The Pi agent directory, for example `~/.anyapp/pi`. */
  agentDir: string
  /** Absolute path to the sub-app root. */
  appPath: string
}): string {
  const slug = `--${resolve(params.appPath).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(params.agentDir, 'sessions', slug)
}

/**
 * Resolve a sub-app's root directory from its id.
 * @param appId - The sub-app identifier
 * @returns Absolute path to `~/.anyapp/apps/<appId>`
 */
export function getAppPath(appId: string): string {
  return join(homedir(), '.anyapp', 'apps', appId)
}
