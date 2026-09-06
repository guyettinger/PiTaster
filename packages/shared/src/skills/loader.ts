/**
 * Skills Loader for managing reusable agent instructions.
 *
 * One loader owns one directory. There are two — the open app's `skills/` and the
 * workspace's `~/.keylimepi/skills` — and {@link buildSkillLibrary} is what puts them
 * together; nothing here knows the other root exists.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Skill, SkillDraft, SkillMention, SkillScope } from '@keylimepi/core'
import { estimateTokens } from './tokens.js'
import { renderSkillEntry } from './manifest.js'

/**
 * The names a skill may have.
 *
 * A name is also a directory name, and it is joined onto a root before any filesystem
 * call. Restricting it to this shape is what keeps `../..` — and anything else with a
 * separator, a leading dot, or a drive letter — from reaching `join`. The IPC handlers
 * validate with this too; do not relax it on one side only.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Whether a string is usable as a skill name.
 * @param name - The candidate name
 * @returns True when the name is safe to join onto a skills root
 */
export function isValidSkillName(name: unknown): name is string {
  return typeof name === 'string' && SKILL_NAME_PATTERN.test(name)
}

/**
 * Parsed skill frontmatter.
 */
interface ParsedFrontmatter {
  /** Skill name from frontmatter. */
  name: string
  /** Skill description from frontmatter. */
  description: string
  /** Skill body content (after frontmatter). */
  body: string
}

/**
 * Parse skill frontmatter from content.
 *
 * `description` is matched to the end of its line only, which is not a limitation to
 * work around but the rule the editor enforces: a wrapped description silently loses
 * everything after the first newline, and the description is the only text the model
 * matches a skill on.
 *
 * @param content - The raw skill file content
 * @returns Parsed frontmatter with name, description, and body
 */
function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

  if (!match) {
    return { name: '', description: '', body: content }
  }

  const frontmatter = match[1]
  const body = match[2]

  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const descMatch = frontmatter.match(/description:\s*(.+)/)

  return {
    name: nameMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    body: body.trim()
  }
}

/**
 * The body of a skill file, parsed the way {@link SkillsLoader} parses it.
 *
 * Exported so the seed migration can compare an on-disk skill against a body Key Lime Pi
 * shipped without re-implementing the frontmatter split — the two comparing differently
 * would mean the migration silently skipping every file.
 *
 * @param content - The raw `SKILL.md` text
 * @returns The trimmed body, with frontmatter removed
 */
export function parseSkillBody(content: string): string {
  return parseSkillFrontmatter(content).body
}

/**
 * Render a skill draft as the text of its `SKILL.md`.
 * @param draft - The skill's editable fields
 * @returns The complete file content, frontmatter included
 */
export function renderSkillFile(draft: SkillDraft): string {
  return `---
name: ${draft.name}
description: ${draft.description}
---

${draft.content}
`
}

/**
 * Loader for one directory of skills.
 */
export class SkillsLoader {
  /**
   * Creates a SkillsLoader instance.
   * @param skillsDir - The skills directory path
   * @param scope - Which library this directory is
   */
  constructor(
    private skillsDir: string,
    private scope: SkillScope
  ) {}

  /** The directory this loader reads. */
  get root(): string {
    return this.skillsDir
  }

  /**
   * Build a {@link Skill} from parsed file content.
   *
   * **A skill's identity is its directory name, never its frontmatter.** The frontmatter
   * `name:` is written by whoever wrote the file — which includes the agent, under
   * `acceptEdits`, from text it may have just fetched off the web. Trusting it would let
   * a file at `skills/anything/SKILL.md` declare `name: manage-versions`, shadow the
   * workspace skill of that name, and have `load_skill('manage-versions')` return its
   * body — which the system prompt tells the model to follow. One auto-approved write,
   * and every later session loads it. A directory entry cannot contain a separator and
   * cannot be forged from inside a file, so the filesystem is the safe source.
   *
   * `save` writes the two in step, so they only ever disagree on a hand-written file.
   *
   * @param parsed - The parsed frontmatter and body
   * @param dirName - The directory the skill was found in, and its identity
   * @param filepath - Absolute path to its `SKILL.md`
   * @returns A skill with its derived fields filled in
   */
  private toSkill(parsed: ParsedFrontmatter, dirName: string, filepath: string): Skill {
    const skill: Skill = {
      name: dirName,
      description: parsed.description,
      content: parsed.body,
      filepath,
      scope: this.scope,
      enabled: true,
      manifestTokens: 0,
      bodyTokens: estimateTokens(parsed.body),
      outdated: false,
      shadowed: false,
      loadedThisChat: 0
    }
    skill.manifestTokens = estimateTokens(renderSkillEntry(skill))
    return skill
  }

  /**
   * Load all skills from the skills directory.
   * @returns Array of loaded skills, sorted by name
   */
  async loadAll(): Promise<Skill[]> {
    const skills: Skill[] = []

    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(this.skillsDir, entry.name, 'SKILL.md')
        try {
          const content = await fs.readFile(skillPath, 'utf-8')
          skills.push(this.toSkill(parseSkillFrontmatter(content), entry.name, skillPath))
        } catch {
          // A directory without a SKILL.md is not a skill.
        }
      }
    } catch {
      // Skills directory doesn't exist. Neither root is required to.
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Load a specific skill by name.
   * @param name - The skill name
   * @returns The skill, or null if it is missing or the name is unusable
   */
  async load(name: string): Promise<Skill | null> {
    if (!isValidSkillName(name)) return null

    const skillPath = join(this.skillsDir, name, 'SKILL.md')

    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      return this.toSkill(parseSkillFrontmatter(content), name, skillPath)
    } catch {
      return null
    }
  }

  /**
   * Save a skill, creating its directory if needed.
   * @param draft - The skill's editable fields
   * @returns The saved skill, reloaded from what was written
   * @throws {Error} If the name is not a usable skill name
   */
  async save(draft: SkillDraft): Promise<Skill> {
    if (!isValidSkillName(draft.name)) {
      throw new Error(
        `Invalid skill name "${draft.name}". Use lowercase letters, numbers and hyphens.`
      )
    }

    const skillDir = join(this.skillsDir, draft.name)
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(join(skillDir, 'SKILL.md'), renderSkillFile(draft))

    const saved = await this.load(draft.name)
    if (!saved) throw new Error(`Saved skill "${draft.name}" could not be read back`)
    return saved
  }

  /**
   * Delete a skill and its directory.
   * @param name - The skill name to delete
   * @throws {Error} If the name is not a usable skill name
   */
  async delete(name: string): Promise<void> {
    if (!isValidSkillName(name)) {
      throw new Error(`Invalid skill name "${name}"`)
    }
    await fs.rm(join(this.skillsDir, name), { recursive: true, force: true })
  }
}

/**
 * Extract @mentions from a message.
 * @param message - The message to parse
 * @returns Array of skill mentions with positions
 */
export function extractSkillMentions(message: string): SkillMention[] {
  const mentions: SkillMention[] = []
  const regex = /@([a-z0-9][a-z0-9-]*)/g

  let match
  while ((match = regex.exec(message)) !== null) {
    mentions.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length
    })
  }

  return mentions
}
