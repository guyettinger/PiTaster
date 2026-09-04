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
import { SUPERSEDED_SEEDS } from './superseded-seeds.js'
import { parseSkillBody } from './loader.js'

/**
 * What {@link seedSkills} did.
 */
export interface SeedSkillsResult {
  /** Names of the skills written. */
  installed: string[]
  /** Names already present and therefore left alone. */
  skipped: string[]
  /** Names whose superseded body Pi Taster replaced with the corrected one. */
  corrected: string[]
  /** Names Pi Taster removed because the skill described work this agent cannot do. */
  removed: string[]
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
 * That leaves the case this function used to have no answer for: a skill Pi Taster itself
 * shipped with content that was untrue. `manage-versions` documented nine `version_*`
 * tools that have never existed. Because seeding never overwrites, every install that
 * had ever run kept them forever. So before seeding, any skill whose body still matches
 * one Pi Taster shipped exactly — meaning the user has not touched it — is corrected in
 * place, or deleted when the honest correction is that the skill should not exist. A
 * body that differs by so much as a character is left alone; the panel flags it as
 * outdated instead. See {@link SUPERSEDED_SEEDS}.
 *
 * Failures are per-skill and non-fatal. This runs at startup, and a skill that cannot
 * be written is not a reason for the app not to open.
 *
 * @param skillsDir - The skills root, normally `~/.pitaster/skills`
 * @returns What was installed, left alone, corrected and removed
 */
export async function seedSkills(skillsDir: string): Promise<SeedSkillsResult> {
  const installed: string[] = []
  const skipped: string[] = []
  const corrected: string[] = []
  const removed: string[] = []

  for (const seed of SUPERSEDED_SEEDS) {
    const target = join(skillsDir, seed.name, 'SKILL.md')

    try {
      const onDisk = await fs.readFile(target, 'utf-8')
      if (parseSkillBody(onDisk) !== seed.body) continue

      if (seed.removed) {
        await fs.rm(join(skillsDir, seed.name), { recursive: true, force: true })
        removed.push(seed.name)
        continue
      }

      const replacement = SEED_SKILLS.find((candidate) => candidate.name === seed.name)
      if (!replacement) continue
      await fs.writeFile(target, replacement.content, 'utf-8')
      corrected.push(seed.name)
    } catch {
      // Absent, unreadable, or unwritable. Seeding below covers the absent case, and
      // the other two are not worth failing startup over.
    }
  }

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

  return { installed, skipped, corrected, removed }
}
