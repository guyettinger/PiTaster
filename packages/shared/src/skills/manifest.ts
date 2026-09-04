/**
 * Rendering the skill manifest that goes into every system prompt.
 *
 * This is Pi Taster's own, not Pi's. Pi builds one too — `formatSkillsForPrompt` — but it
 * tells the model to reach a skill with the `read` tool, and every skill outside the
 * open app is refused by `checkConfinement` when it tries. The manifest below names
 * `load_skill` instead, which takes a name rather than a path and so has nothing for
 * confinement to refuse.
 *
 * The entry renderer is exported because the panel reports what a skill costs per
 * request, and that number has to be measured on the text actually sent rather than
 * guessed from the description's length.
 */

import type { Skill } from '@pitaster/core'

/**
 * Escape the five XML entities.
 * @param value - Raw text from a skill file
 * @returns Text safe to place inside an element
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Render one skill's manifest entry.
 *
 * Only the name and description. The body is what `load_skill` fetches, and the path
 * is deliberately absent: a model given a path will try to `read` it.
 *
 * @param skill - The skill to describe
 * @returns The `<skill>` block, without a trailing newline
 */
export function renderSkillEntry(skill: Skill): string {
  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    '  </skill>'
  ].join('\n')
}

/**
 * Render the manifest section for a set of skills.
 *
 * App skills are listed first and the preamble says why, which is cheaper than a
 * `<scope>` element on every entry and tells the model the same thing.
 *
 * @param skills - The skills to advertise, already filtered to the enabled ones
 * @returns A prompt section, or an empty string when there is nothing to advertise
 */
export function renderSkillManifest(skills: Skill[]): string {
  const listed = skills.filter((skill) => skill.description.length > 0)
  if (listed.length === 0) return ''

  const ordered = [
    ...listed.filter((skill) => skill.scope === 'app'),
    ...listed.filter((skill) => skill.scope !== 'app')
  ]

  return `

## Available Skills

Each of these is a short instruction file. When a task matches one's description, call
\`load_skill\` with that name *before* starting the work — the description is a summary,
and the file itself has the steps. Skills written for this app are listed first; prefer
one of those over a general one when both fit.

<available_skills>
${ordered.map(renderSkillEntry).join('\n')}
</available_skills>`
}
