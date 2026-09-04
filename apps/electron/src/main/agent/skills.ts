/**
 * Resolving the skills one session offers the model.
 *
 * Skills come from two roots. The open app's `skills/` directory holds skills written
 * for that app, versioned with it and inside the agent's confinement boundary. The
 * workspace's `~/.pitaster/skills` holds the ones every app is offered.
 *
 * This module is the only place either path is spelled out, because three things have
 * to agree on them: the manifest in the system prompt, the `load_skill` tool, and the
 * Skills panel. If they disagree, the model is advertised a skill it cannot load — the
 * exact failure this whole path exists to end.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { activeSkills, buildSkillLibrary } from '@pitaster/shared'
import type { Skill, SubApp } from '@pitaster/core'

/**
 * The workspace skills root.
 *
 * Outside every app root, and therefore outside what `read` may open — which is why
 * `load_skill` takes a name and reads the file itself rather than pointing the model at
 * a path it would be refused.
 */
export const WORKSPACE_SKILLS_DIR = join(homedir(), '.pitaster', 'skills')

/**
 * The directory an app's own skills live in.
 *
 * `skills/` at the app root, not `.pi/skills`. Pi's project scope is the latter, but
 * `DefaultResourceLoader` runs with `includeDefaults: false` so it discovers neither —
 * the path is Pi Taster's to choose, and this is the one the agent already reaches for
 * when it writes a skill, because it is plainly visible in a directory listing.
 *
 * @param rootPath - Absolute path to the sub-app root
 * @returns Absolute path to that app's skills directory
 */
export function getAppSkillsDir(rootPath: string): string {
  return join(rootPath, 'skills')
}

/**
 * Load the skills a session should advertise and allow.
 *
 * Returns only the active ones: enabled by the app, not shadowed by a same-named app
 * skill, and carrying a description — a skill without one can never be matched, so
 * advertising it costs tokens for nothing.
 *
 * @param app - The sub-app the session operates on
 * @returns Active skills, app-scoped first
 */
export async function loadSessionSkills(app: SubApp): Promise<Skill[]> {
  try {
    const library = await buildSkillLibrary({
      appSkillsDir: getAppSkillsDir(app.path),
      workspaceSkillsDir: WORKSPACE_SKILLS_DIR,
      disabledSkills: app.disabledSkills
    })

    return activeSkills(library)
  } catch {
    // Skills are optional and this runs on the path that builds the session. Both
    // loaders already swallow a missing or unreadable directory, so nothing here is
    // expected to throw — but an agent that will not start because a skill folder is
    // malformed is a much worse failure than one running without skills.
    return []
  }
}
