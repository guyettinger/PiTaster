import type { Skill } from '@keylimepi/core'

/**
 * Filter a library by a search string, over name and description.
 *
 * Name and description rather than body, deliberately: those two are what the
 * model matches a task against, so searching them is searching the same text the
 * agent does. A body search would find skills the agent could never reach.
 *
 * @param skills - The library's skills
 * @param search - What the user typed
 * @returns The matching skills
 */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const needle = search.trim().toLowerCase()
  if (needle.length === 0) return skills

  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
  )
}
