/**
 * Filesystem layout for Pi session transcripts.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { isValidAppId } from '../apps/manager.js'

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
 *
 * The second place in the codebase an app id becomes a path, and it is not a read-only
 * one: `ChatHistoryManager.writePointer` and `createSession` `mkdir -p` this path and
 * write into it. So it needs the same guard as {@link AppManager.appDir} for the same
 * reason — `join` resolves `../../../tmp` without complaint, and an id reaches here from
 * `apps:delete` and from `activeAppId`.
 *
 * This throws rather than returning null. Every caller has already obtained the id from
 * a validated `SubApp`, so an invalid one here is a violated invariant, not a miss — and
 * the one caller that can pass an unvetted id (`apps:delete`, through `listSessions`)
 * already runs inside a try/catch that treats a failure as "no sessions to forget".
 *
 * @param appId - The sub-app identifier
 * @returns Absolute path to `~/.anyapp/apps/<appId>`
 * @throws {Error} If the id does not name a single directory inside the apps root
 */
export function getAppPath(appId: string): string {
  if (!isValidAppId(appId)) {
    throw new Error(`Invalid app ID: ${JSON.stringify(appId)}`)
  }
  return join(homedir(), '.anyapp', 'apps', appId)
}
