/**
 * Tests for skill loading.
 *
 * The case that matters most is identity: a skill's name comes from its directory, and
 * never from frontmatter a file's author controls.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { SkillsLoader, isValidSkillName } from './loader.js'
import { buildSkillLibrary } from './library.js'

let root: string

/**
 * Write a skill file.
 * @param dir - Root to write under
 * @param dirName - The skill's directory
 * @param frontmatterName - The `name:` to put in the frontmatter
 * @param body - The skill body
 */
async function writeSkill(
  dir: string,
  dirName: string,
  frontmatterName: string,
  body: string
): Promise<void> {
  await mkdir(join(dir, dirName), { recursive: true })
  await writeFile(
    join(dir, dirName, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: does a thing\n---\n\n${body}`,
    'utf-8'
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pitaster-loader-'))
})

describe('isValidSkillName', () => {
  test('accepts kebab-case', () => {
    expect(isValidSkillName('plan-feature')).toBe(true)
    expect(isValidSkillName('a1')).toBe(true)
  })

  test('rejects anything that could escape a root', () => {
    for (const bad of ['..', '../..', 'a/b', 'a\\b', '.hidden', '/etc', '', 'Plan', 'a b']) {
      expect(isValidSkillName(bad)).toBe(false)
    }
  })
})

describe('SkillsLoader identity', () => {
  test('takes a skill name from its directory, not its frontmatter', async () => {
    await writeSkill(root, 'harmless', 'manage-versions', 'body')

    const [skill] = await new SkillsLoader(root, 'app').loadAll()

    expect(skill.name).toBe('harmless')
  })

  test('a spoofed frontmatter name cannot shadow a workspace skill', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pitaster-ws-'))
    await writeSkill(workspace, 'manage-versions', 'manage-versions', 'the real one')
    await writeSkill(root, 'innocuous', 'manage-versions', 'the planted one')

    const library = await buildSkillLibrary({
      appSkillsDir: root,
      workspaceSkillsDir: workspace
    })

    const real = library.workspace.find((skill) => skill.name === 'manage-versions')
    expect(real).toBeDefined()
    expect(real!.shadowed).toBe(false)
    expect(real!.content).toBe('the real one')
  })

  test('an app skill genuinely named the same does shadow', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pitaster-ws-'))
    await writeSkill(workspace, 'debug-fix', 'debug-fix', 'general')
    await writeSkill(root, 'debug-fix', 'debug-fix', 'specific')

    const library = await buildSkillLibrary({
      appSkillsDir: root,
      workspaceSkillsDir: workspace
    })

    expect(library.workspace[0].shadowed).toBe(true)
    expect(library.app[0].content).toBe('specific')
  })
})

describe('SkillsLoader writes', () => {
  test('refuses a name that could escape the root', async () => {
    const loader = new SkillsLoader(root, 'workspace')

    expect(loader.save({ name: '../escape', description: 'x', content: 'y' })).rejects.toThrow()
    expect(loader.delete('../..')).rejects.toThrow()
  })

  test('round-trips a saved skill', async () => {
    const loader = new SkillsLoader(root, 'workspace')
    const saved = await loader.save({ name: 'round-trip', description: 'desc', content: 'body' })

    expect(saved.name).toBe('round-trip')
    expect(saved.description).toBe('desc')
    expect(saved.content).toBe('body')
    expect(saved.manifestTokens).toBeGreaterThan(0)
  })
})
