/**
 * Tests for skill seeding.
 *
 * The case that matters most is the second run: seeding that reasserted itself would
 * discard whatever the user had edited in the Skills panel.
 */

import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { SEED_SKILLS } from './seed-content.js'
import { seedSkills } from './seed.js'
import { SUPERSEDED_SEEDS } from './superseded-seeds.js'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'pitaster-skills-'))
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

describe('seed content stays in step with docs/skills', () => {
  test('every seed matches its editable source file', async () => {
    const docsDir = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'skills')

    for (const skill of SEED_SKILLS) {
      const source = await readFile(join(docsDir, skill.name, 'SKILL.md'), 'utf-8')
      expect(source).toBe(skill.content)
    }
  })

  test('no skill exists in docs/skills that was left out of the seeds', async () => {
    const docsDir = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'skills')
    const entries = await readdir(docsDir, { withFileTypes: true })
    const onDisk = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

    expect(onDisk.sort()).toEqual(SEED_SKILLS.map((skill) => skill.name).sort())
  })
})

describe('superseded seeds', () => {
  test('replaces a body Pi Taster shipped and has since corrected', async () => {
    const stale = SUPERSEDED_SEEDS.find((seed) => !seed.removed)!
    await mkdir(join(skillsDir, stale.name), { recursive: true })
    await writeFile(
      join(skillsDir, stale.name, 'SKILL.md'),
      `---\nname: ${stale.name}\ndescription: old\n---\n\n${stale.body}`,
      'utf-8'
    )

    const result = await seedSkills(skillsDir)

    expect(result.corrected).toContain(stale.name)
    const now = await readFile(join(skillsDir, stale.name, 'SKILL.md'), 'utf-8')
    expect(now).toBe(SEED_SKILLS.find((seed) => seed.name === stale.name)!.content)
  })

  test('deletes a superseded skill whose correction is to not exist', async () => {
    const gone = SUPERSEDED_SEEDS.find((seed) => seed.removed)!
    await mkdir(join(skillsDir, gone.name), { recursive: true })
    await writeFile(
      join(skillsDir, gone.name, 'SKILL.md'),
      `---\nname: ${gone.name}\ndescription: old\n---\n\n${gone.body}`,
      'utf-8'
    )

    const result = await seedSkills(skillsDir)

    expect(result.removed).toContain(gone.name)
    expect(existsSync(join(skillsDir, gone.name))).toBe(false)
  })

  test('leaves a body the user has edited alone, even by one character', async () => {
    const stale = SUPERSEDED_SEEDS.find((seed) => !seed.removed)!
    const edited = `---\nname: ${stale.name}\ndescription: mine\n---\n\n${stale.body} `
    await mkdir(join(skillsDir, stale.name), { recursive: true })
    await writeFile(join(skillsDir, stale.name, 'SKILL.md'), `${edited}x`, 'utf-8')

    const result = await seedSkills(skillsDir)

    expect(result.corrected).not.toContain(stale.name)
    expect(await readFile(join(skillsDir, stale.name, 'SKILL.md'), 'utf-8')).toBe(`${edited}x`)
  })
})
