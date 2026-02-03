/**
 * Skills Loader for managing reusable agent instructions.
 */

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import type { Skill, SkillMention } from '@clirabbit/core'

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
 * Loader for managing skills (reusable agent instructions).
 */
export class SkillsLoader {
  /**
   * Creates a SkillsLoader instance.
   * @param skillsDir - The skills directory path
   */
  constructor(private skillsDir: string) {}

  /**
   * Load all skills from the skills directory.
   * @returns Array of loaded skills
   */
  async loadAll(): Promise<Skill[]> {
    const skills: Skill[] = []

    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(this.skillsDir, entry.name, 'SKILL.md')
          try {
            const content = await fs.readFile(skillPath, 'utf-8')
            const parsed = parseSkillFrontmatter(content)

            skills.push({
              name: parsed.name || entry.name,
              description: parsed.description,
              content: parsed.body,
              filepath: skillPath
            })
          } catch {
            // Skill doesn't have SKILL.md, skip
          }
        }
      }
    } catch {
      // Skills directory doesn't exist
    }

    return skills
  }

  /**
   * Load a specific skill by name.
   * @param name - The skill name
   * @returns The skill or null if not found
   */
  async load(name: string): Promise<Skill | null> {
    const skillPath = join(this.skillsDir, name, 'SKILL.md')

    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      const parsed = parseSkillFrontmatter(content)

      return {
        name: parsed.name || name,
        description: parsed.description,
        content: parsed.body,
        filepath: skillPath
      }
    } catch {
      return null
    }
  }

  /**
   * Save a skill.
   * @param skill - The skill to save
   */
  async save(skill: Skill): Promise<void> {
    const skillDir = join(this.skillsDir, skill.name)
    await fs.mkdir(skillDir, { recursive: true })

    const content = `---
name: ${skill.name}
description: ${skill.description}
---

${skill.content}`

    await fs.writeFile(join(skillDir, 'SKILL.md'), content)
  }

  /**
   * Delete a skill.
   * @param name - The skill name to delete
   */
  async delete(name: string): Promise<void> {
    const skillDir = join(this.skillsDir, name)
    await fs.rm(skillDir, { recursive: true })
  }
}

/**
 * Extract @mentions from a message.
 * @param message - The message to parse
 * @returns Array of skill mentions with positions
 */
export function extractSkillMentions(message: string): SkillMention[] {
  const mentions: SkillMention[] = []
  const regex = /@([a-z0-9-]+)/g

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

/**
 * Build system prompt with skill content injected.
 * @param basePrompt - The base system prompt
 * @param skills - Skills to inject
 * @returns System prompt with skill sections appended
 */
export function buildSystemPrompt(basePrompt: string, skills: Skill[]): string {
  if (skills.length === 0) {
    return basePrompt
  }

  const skillsSection = skills
    .map((s) => `## Skill: ${s.name}\n\n${s.content}`)
    .join('\n\n---\n\n')

  return `${basePrompt}

---

# Active Skills

${skillsSection}`
}
