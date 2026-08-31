/**
 * Installs the seed skills into the user's skills directory.
 *
 * See `./seed-content.ts` for why they are embedded and why this exists at all: the
 * skills directory was read by both the agent and the UI and written by neither, so a
 * fresh install had none.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { SEED_SKILLS } from './seed-content.js'

/**
 * What {@link seedSkills} did.
 */
export interface SeedSkillsResult {
  /** Names of the skills written. */
  installed: string[]
  /** Names already present and therefore left alone. */
  skipped: string[]
}

/**
 * Write any seed skill that is not already installed.
 *
 * A skill already on disk is never overwritten. The Skills panel lets the user edit
 * these, and a seeding step that reasserted itself on every launch would silently
 * discard that work — the skills are seeds, not managed content. Deleting one is also a
 * decision, but an undetectable one from here, so a deleted skill does come back; the
 * panel is where it can be emptied instead.
 *
 * Failures are per-skill and non-fatal. This runs at startup, and a skill that cannot
 * be written is not a reason for the app not to open.
 *
 * @param skillsDir - The skills root, normally `~/.anyapp/skills`
 * @returns Which skills were installed and which were already there
 */
export async function seedSkills(skillsDir: string): Promise<SeedSkillsResult> {
  const installed: string[] = []
  const skipped: string[] = []

  for (const skill of SEED_SKILLS) {
    const target = join(skillsDir, skill.name, 'SKILL.md')

    try {
      await fs.access(target)
      skipped.push(skill.name)
      continue
    } catch {
      // Absent, so write it.
    }

    try {
      await fs.mkdir(join(skillsDir, skill.name), { recursive: true })
      await fs.writeFile(target, skill.content, 'utf-8')
      installed.push(skill.name)
    } catch {
      // A skill that will not write is not worth failing startup over; the agent
      // degrades to running without it, which is what it did before this module.
    }
  }

  return { installed, skipped }
}
