/**
 * Assembling the two skill libraries an app sees.
 *
 * Skills come from two roots and the model is offered one list, so three things have to
 * be decided in one place: which root wins a name collision, which skills the app has
 * turned off, and which of the workspace's copies are still worth showing the user.
 */

import type { Skill, SkillLibrary } from '@anyapp/core'
import { SkillsLoader } from './loader.js'
import { isSupersededSeed } from './superseded-seeds.js'

/**
 * Parameters for {@link buildSkillLibrary}.
 */
export interface BuildSkillLibraryParams {
  /** The open app's `skills/` directory, or null when no app is open. */
  appSkillsDir: string | null
  /** The workspace skills directory, normally `~/.anyapp/skills`. */
  workspaceSkillsDir: string
  /** Names the app has turned off. */
  disabledSkills?: string[]
}

/**
 * Load both skill roots and resolve them against each other.
 *
 * An app skill wins a name collision, because it was written for the app in front of
 * the user and `load_skill` resolves the app root first. The workspace copy is kept in
 * the list and marked `shadowed` rather than dropped — it still exists on disk, and a
 * user looking for why their workspace skill has no effect needs to see it.
 *
 * @param params - The two roots and the app's disabled names
 * @returns Both libraries, with `enabled`, `shadowed` and `outdated` resolved
 */
export async function buildSkillLibrary({
  appSkillsDir,
  workspaceSkillsDir,
  disabledSkills = []
}: BuildSkillLibraryParams): Promise<SkillLibrary> {
  const [app, workspace] = await Promise.all([
    appSkillsDir ? new SkillsLoader(appSkillsDir, 'app').loadAll() : Promise.resolve([]),
    new SkillsLoader(workspaceSkillsDir, 'workspace').loadAll()
  ])

  const disabled = new Set(disabledSkills)
  const appNames = new Set(app.map((skill) => skill.name))

  for (const skill of app) {
    skill.enabled = !disabled.has(skill.name)
  }

  for (const skill of workspace) {
    skill.enabled = !disabled.has(skill.name)
    skill.shadowed = appNames.has(skill.name)
    skill.outdated = isSupersededSeed(skill.name, skill.content)
  }

  return { app, workspace }
}

/**
 * The skills that actually reach the model.
 *
 * `enabled` is the user's intent and `shadowed` is a fact about the two roots; a skill
 * needs both to go out, and it needs a description, since that is the only thing the
 * model can match it on.
 *
 * @param library - Both libraries
 * @returns App skills first, then workspace skills
 */
export function activeSkills(library: SkillLibrary): Skill[] {
  return [...library.app, ...library.workspace].filter(
    (skill) => skill.enabled && !skill.shadowed && skill.description.length > 0
  )
}
