/**
 * `load_skill` — the tool that hands the model a skill's instructions.
 *
 * Skills used to be delivered the way Pi delivers them: the manifest carried each
 * skill's absolute path and told the model to open it with `read`. Every workspace
 * skill lives under `~/.anyapp/skills`, `read` is a path tool, and `checkConfinement`
 * refuses any path outside the app root — so the model was shown a list of skills and
 * refused every one it tried to open. The bodies had never reached a model.
 *
 * The fix is not a hole in confinement. This tool takes a **name**, never a path, and
 * resolves it against the two roots itself, so there is nothing for `checkConfinement`
 * to decide and no way to spell an argument that reaches another file. It is classified
 * with the file tools in `checkPermission`, so it prompts and auto-approves exactly as
 * `read` does — the model is not gaining reach, it is gaining the one file it was
 * always being pointed at.
 *
 * A loaded skill is also visible in the transcript as a tool call, which the old path
 * could never be: the user can see which instructions the agent is working from.
 */

import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { dirname } from 'node:path'
import type { Skill } from '@anyapp/core'

/** The tools this module contributes. */
export const SKILL_TOOL_NAMES = ['load_skill']

/**
 * A Pi tool result carrying one block of text.
 */
interface TextToolResult {
  /** The result content. */
  content: Array<{ type: 'text'; text: string }>
  /** Structured details; unused here, but Pi's shape requires the field. */
  details: Record<string, never>
}

/**
 * Wrap text as a tool result.
 * @param text - The message for the model
 * @param isError - Whether this reports a failure
 * @returns A Pi tool result
 */
function textResult(text: string, isError = false): TextToolResult & { isError?: boolean } {
  return { content: [{ type: 'text', text }], details: {}, ...(isError ? { isError: true } : {}) }
}

/**
 * Render a loaded skill for the model.
 *
 * The skill's own directory is stated because a skill may reference files beside it, and
 * a relative path in a skill body means "relative to the skill", not to the app root.
 * Without this the model resolves those against `cwd` and reads the wrong file, or
 * nothing.
 *
 * @param skill - The skill that was loaded
 * @returns The tool result text
 */
function renderSkill(skill: Skill): string {
  return `# Skill: ${skill.name}

${skill.content}

---
This skill's own directory is ${dirname(skill.filepath)}. Resolve any relative path the
skill mentions against that directory, not the working directory.`
}

/**
 * Parameters for {@link createSkillTools}.
 */
export interface CreateSkillToolsParams {
  /**
   * The skills this session offers.
   *
   * Resolved once when the session is built, which is also what the manifest is built
   * from — so the tool can load exactly what was advertised, and nothing else. A skill
   * the agent writes mid-session is not in this list; it becomes loadable in the next
   * session, and until then the agent has just written the file and knows its contents.
   */
  skills: Skill[]
}

/**
 * Build the skill tools for a session.
 * @param params - The session's active skills
 * @returns Pi tool definitions
 */
export function createSkillTools({ skills }: CreateSkillToolsParams): ToolDefinition[] {
  return [
    defineTool({
      name: 'load_skill',
      label: 'Load skill',
      description:
        "Load a skill's full instructions by name. Call this when a task matches one of the skills listed in Available Skills, before starting the work.",
      parameters: Type.Object({
        name: Type.String({ description: 'The skill name, exactly as listed in Available Skills' })
      }),
      execute: async (_toolCallId, { name }) => {
        const wanted = typeof name === 'string' ? name.trim() : ''
        const skill = skills.find((candidate) => candidate.name === wanted)

        if (!skill) {
          const available = skills.map((candidate) => candidate.name)
          return textResult(
            available.length === 0
              ? `There is no skill named "${wanted}". This session has no skills available.`
              : `There is no skill named "${wanted}". Available skills: ${available.join(', ')}.`,
            true
          )
        }

        return textResult(renderSkill(skill))
      }
    })
  ]
}
