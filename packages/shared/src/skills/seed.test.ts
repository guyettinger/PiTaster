/**
 * Tests for skill seeding.
 *
 * The case that matters most is the second run: seeding that reasserted itself would
 * discard whatever the user had edited in the Skills panel.
 */

import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { SEED_SKILLS } from './seed-content.js'
import { seedSkills } from './seed.js'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'anyapp-skills-'))
})

describe('SEED_SKILLS', () => {
  test('carries the working-notes skill the compaction nudge depends on', () => {
    const notes = SEED_SKILLS.find((skill) => skill.name === 'working-notes')
    expect(notes).toBeDefined()
    expect(notes!.content).toContain('NOTES.md')
  })

  test('every entry is a parseable SKILL.md whose frontmatter name matches its directory', () => {
    for (const skill of SEED_SKILLS) {
      const match = /^---\n([\s\S]*?)\n---\n/.exec(skill.content)
      expect(match).not.toBeNull()
      expect(/name:\s*(.+)/.exec(match![1])?.[1].trim()).toBe(skill.name)
      expect(/description:\s*(.+)/.exec(match![1])?.[1].trim()).toBeTruthy()
    }
  })
})

describe('seedSkills', () => {
  test('installs every skill into an empty directory', async () => {
    const result = await seedSkills(skillsDir)

    expect(result.installed).toEqual(SEED_SKILLS.map((skill) => skill.name))
    expect(result.skipped).toEqual([])

    const written = await readFile(join(skillsDir, 'working-notes', 'SKILL.md'), 'utf-8')
    expect(written).toContain('NOTES.md')
  })

  test('never overwrites a skill the user has edited', async () => {
    await mkdir(join(skillsDir, 'working-notes'), { recursive: true })
    await writeFile(join(skillsDir, 'working-notes', 'SKILL.md'), 'mine', 'utf-8')

    const result = await seedSkills(skillsDir)

    expect(result.skipped).toContain('working-notes')
    expect(result.installed).not.toContain('working-notes')
    expect(await readFile(join(skillsDir, 'working-notes', 'SKILL.md'), 'utf-8')).toBe('mine')
  })

  test('is idempotent across runs', async () => {
    await seedSkills(skillsDir)
    const second = await seedSkills(skillsDir)

    expect(second.installed).toEqual([])
    expect(second.skipped).toHaveLength(SEED_SKILLS.length)
  })
})
